import Fastify from 'fastify';
import { Redis } from 'ioredis';
import pino from 'pino';
import { PublishBodySchema } from './schema.js';
import { StreamBus } from './streams.js';
import { WsGateway } from './ws.js';
import { TopicRing } from './ring.js';

const port = Number(process.env.IACP_PORT ?? 8080);
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const logLevel = process.env.LOG_LEVEL ?? 'info';

const log = pino({ level: logLevel, name: 'iacp' });

async function main(): Promise<void> {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  redis.on('error', (err) => log.error({ err: err.message }, 'redis error'));

  const consumerId = `iacp-${process.pid}-${Date.now()}`;
  const bus = new StreamBus(redis, 'iacp', consumerId, log);
  const ring = new TopicRing(Number(process.env.IACP_RING_CAP ?? 256));
  const gateway = new WsGateway(bus, log, ring);

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
      return { error: 'bad_envelope', detail: parsed.error.flatten() };
    }
    const env = parsed.data.envelope;
    // Service-role auth header required for REST publish path — reject otherwise.
    const token = req.headers['x-iacp-service-token'];
    const expected = process.env.IACP_SERVICE_TOKEN;
    if (!expected || token !== expected) {
      reply.code(401);
      return { error: 'unauthorized' };
    }
    await bus.ensureGroup(env.topic);
    const streamId = await bus.publish(env);
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
