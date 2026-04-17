import crypto from 'node:crypto';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import pino from 'pino';
import { Connection, PublicKey } from '@solana/web3.js';
import { SAEP_PROGRAM_IDS } from '@saep/sdk';
import { PublishBodySchema } from './schema.js';
import { StreamBus } from './streams.js';
import { WsGateway } from './ws.js';
import { TopicRing } from './ring.js';
import {
  loadSessionSecret,
  isEnvelopeTsFresh,
  DEFAULT_MAX_ENVELOPE_AGE_MS,
  DEFAULT_ENVELOPE_CLOCK_SKEW_MS,
  type FreshnessOptions,
} from './auth.js';
import { RpcAgentLookup, type AgentLookup } from './agents.js';
import { buildAnchor } from './anchor.js';
import { LagSampler, DEFAULT_LAG_INTERVAL_MS } from './lag.js';
import {
  buildMsgLimiter,
  defaultLimiterConfig,
  type LimiterConfig,
  DEFAULT_MSG_BURST,
  DEFAULT_MSG_SUSTAINED_PER_S,
  DEFAULT_BW_BURST_BYTES,
  DEFAULT_BW_SUSTAINED_BYTES_PER_S,
} from './rate_limit.js';
import {
  registry,
  recordPublish,
  recordRateLimited,
  recordRejection,
} from './metrics.js';

const port = Number(process.env.IACP_PORT ?? 8080);
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const logLevel = process.env.LOG_LEVEL ?? 'info';

const log = pino({ level: logLevel, name: 'iacp' });

function buildAgentLookup(log: pino.Logger): AgentLookup | null {
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim();
  if (!rpcUrl) {
    log.warn('SOLANA_RPC_URL unset — agent_registry lookup disabled, publishes not gated on Active status');
    return null;
  }
  const programIdRaw =
    process.env.AGENT_REGISTRY_PROGRAM_ID?.trim() || SAEP_PROGRAM_IDS.agentRegistry;
  const programId = new PublicKey(programIdRaw);
  const connection = new Connection(rpcUrl, 'confirmed');
  log.info({ programId: programId.toBase58() }, 'agent_registry lookup enabled');
  return new RpcAgentLookup(connection, programId, log);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function loadLimiterConfig(): LimiterConfig {
  return {
    msgBurst: parsePositiveInt(process.env.IACP_RL_BURST, DEFAULT_MSG_BURST),
    msgSustainedPerS: parsePositiveInt(
      process.env.IACP_RL_SUSTAINED_PER_S,
      DEFAULT_MSG_SUSTAINED_PER_S,
    ),
    bwBurstBytes: parsePositiveInt(process.env.IACP_BW_BURST_BYTES, DEFAULT_BW_BURST_BYTES),
    bwSustainedBytesPerS: parsePositiveInt(
      process.env.IACP_BW_SUSTAINED_BYTES_PER_S,
      DEFAULT_BW_SUSTAINED_BYTES_PER_S,
    ),
  };
}

async function main(): Promise<void> {
  const sessionSecret = loadSessionSecret();
  const agentLookup = buildAgentLookup(log);

  const freshness: FreshnessOptions = {
    maxAgeMs: parsePositiveInt(process.env.IACP_ENVELOPE_MAX_AGE_MS, DEFAULT_MAX_ENVELOPE_AGE_MS),
    maxSkewMs: parsePositiveInt(process.env.IACP_ENVELOPE_CLOCK_SKEW_MS, DEFAULT_ENVELOPE_CLOCK_SKEW_MS),
  };

  const limits = loadLimiterConfig();
  log.info(limits, 'rate limits');

  const anchor = buildAnchor(log);

  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  redis.on('error', (err) => log.error({ err: err.message }, 'redis error'));

  const consumerId = `iacp-${process.pid}-${Date.now()}`;
  const bus = new StreamBus(redis, 'iacp', consumerId, log);
  const ring = new TopicRing(Number(process.env.IACP_RING_CAP ?? 256));

  // REST publish shares the per-agent msg limiter with WS — any agent is capped
  // in aggregate across both paths. Bandwidth (per-socket) is WS-only.
  const restMsgLimiter = buildMsgLimiter(limits);
  const gateway = new WsGateway(bus, log, ring, sessionSecret, agentLookup, {
    freshness,
    limits,
    msgLimiter: restMsgLimiter,
    anchor,
  });

  const app = Fastify({ loggerInstance: log });

  app.get('/healthz', async () => ({
    status: 'ok',
    connectedClients: gateway.sessionCount(),
    topics: Array.from(gateway.topicSubscribers.keys()),
  }));
  app.get('/readyz', async () => {
    const pong = await redis.ping();
    return { ok: pong === 'PONG' };
  });

  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/topics/:id/recent',
    async (req, reply) => {
      const limit = req.query.limit ? Math.max(1, Math.min(256, Number(req.query.limit))) : 64;
      const entries = ring.recent(req.params.id, limit);
      reply.header('cache-control', 'no-store');
      return { topic: req.params.id, count: entries.length, entries };
    },
  );

  app.post('/publish', async (req, reply) => {
    const parsed = PublishBodySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      recordRejection('rest', 'bad_envelope');
      return { error: 'bad_envelope', detail: parsed.error.flatten() };
    }
    const env = parsed.data.envelope;
    const token = req.headers['x-iacp-service-token'];
    const expected = process.env.IACP_SERVICE_TOKEN;
    if (
      !expected ||
      typeof token !== 'string' ||
      token.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
    ) {
      reply.code(401);
      recordRejection('rest', 'unauthorized');
      return { error: 'unauthorized' };
    }
    if (!isEnvelopeTsFresh(env.ts, Date.now(), freshness)) {
      reply.code(422);
      recordRejection('rest', 'stale_ts');
      recordPublish('rest', env.topic, 'rejected');
      return { error: 'stale_ts' };
    }
    const msgCheck = restMsgLimiter.consume(env.from_agent);
    if (!msgCheck.allowed) {
      reply.code(429);
      reply.header('retry-after', Math.max(1, Math.ceil(msgCheck.retryAfterMs / 1000)));
      recordRateLimited('rest', 'msg');
      recordPublish('rest', env.topic, 'rate_limited');
      return { error: 'rate_limited', retry_after_ms: msgCheck.retryAfterMs };
    }
    if (agentLookup && !(await agentLookup.isActiveOperator(env.from_agent))) {
      reply.code(403);
      recordRejection('rest', 'not_active');
      recordPublish('rest', env.topic, 'rejected');
      return { error: 'not_active' };
    }
    const start = performance.now();
    await bus.ensureGroup(env.topic);
    const streamId = await bus.publish(env);
    anchor?.enqueue(env);
    recordPublish('rest', env.topic, 'ok', (performance.now() - start) / 1000);
    return { id: env.id, stream_id: streamId };
  });

  app.server.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/ws')) {
      void gateway.handleUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  let running = true;
  const pump = async (): Promise<void> => {
    while (running) {
      try {
        const topics = Array.from(gateway.topicSubscribers.keys());
        if (topics.length === 0) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        const messages = await bus.read(topics, 2_000, 128);
        for (const m of messages) {
          gateway.dispatch(m.topic, m.envelope, m.streamId);
          await bus.ack(m.topic, m.streamId);
        }
      } catch (err) {
        log.error({ err: err instanceof Error ? err.message : String(err) }, 'pump error');
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }
  };

  const sweepMs = parsePositiveInt(process.env.IACP_RL_SWEEP_MS, 30_000);
  const sweepHandle = setInterval(() => gateway.sweepLimiters(), sweepMs);
  sweepHandle.unref?.();

  const lagIntervalMs = parsePositiveInt(process.env.IACP_LAG_INTERVAL_MS, DEFAULT_LAG_INTERVAL_MS);
  const lagSampler = new LagSampler(
    redis,
    'iacp',
    () => gateway.topicSubscribers.keys(),
    log,
    { intervalMs: lagIntervalMs },
  );
  lagSampler.start();

  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'iacp listening');
  void pump();

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'shutting down');
    running = false;
    clearInterval(sweepHandle);
    lagSampler.stop();
    await app.close();
    if (anchor) await anchor.stop();
    await redis.quit();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error({ err: err instanceof Error ? err.message : String(err) }, 'fatal');
  process.exit(1);
});
