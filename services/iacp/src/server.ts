import Fastify from 'fastify';
import { Redis } from 'ioredis';
import pino from 'pino';
import { PublishBodySchema } from './schema.js';
import { StreamBus } from './streams.js';
import { WsGateway } from './ws.js';

const port = Number(process.env.IACP_PORT ?? 8080);
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const logLevel = process.env.LOG_LEVEL ?? 'info';

const log = pino({ level: logLevel, name: 'iacp' });

async function main(): Promise<void> {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  redis.on('error', (err) => log.error({ err: err.message }, 'redis error'));

  const consumerId = `iacp-${process.pid}-${Date.now()}`;
  const bus = new StreamBus(redis, 'iacp', consumerId, log);
  const gateway = new WsGateway(bus, log);

  const app = Fastify({ loggerInstance: log });

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async () => {
    const pong = await redis.ping();
    return { ok: pong === 'PONG' };
  });

  app.post('/publish', async (req, reply) => {
    const parsed = PublishBodySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'bad_envelope', detail: parsed.error.flatten() };
    }
    const env = parsed.data.envelope;
    // SIWS-AUTH-STUB: service-role token check for server-to-server publishes.
    // SIGNATURE-VERIFY-STUB + AGENT-REGISTRY-LOOKUP-STUB: same path as WS publish.
    await bus.ensureGroup(env.topic);
    const streamId = await bus.publish(env);
    return { id: env.id, stream_id: streamId };
  });

  app.server.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/ws')) {
      gateway.handleUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  let running = true;
  const pump = async (): Promise<void> => {
    while (running) {
      try {
        const messages = await bus.read(Array.from(subscribedTopics()), 2_000, 128);
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

  const subscribedTopics = (): Set<string> => {
    // IPFS-ARCHIVE-STUB: sweeper process will read trimmed ranges and push to IPFS,
    // then persist CID + range to iacp_archives in Postgres.
    const topics = new Set<string>();
    for (const set of (gateway as unknown as { topicSubscribers: Map<string, Set<unknown>> }).topicSubscribers.values()) {
      void set;
    }
    for (const [topic] of (gateway as unknown as { topicSubscribers: Map<string, Set<unknown>> }).topicSubscribers) {
      topics.add(topic);
    }
    return topics;
  };

  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'iacp listening');
  void pump();

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'shutting down');
    running = false;
    await app.close();
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
