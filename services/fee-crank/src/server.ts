import Fastify from 'fastify';
import pino from 'pino';
import { loadConfig } from './config.js';
import { registry } from './metrics.js';
import { startWorker } from './worker.js';

export async function buildServer() {
  const config = loadConfig();
  const log = pino({ level: config.logLevel, name: 'fee-crank' });

  const app = Fastify({ loggerInstance: log });

  app.get('/healthz', async () => ({ status: 'ok', cluster: config.cluster }));

  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });

  const worker = startWorker({ config, log });
  worker.start();
  log.info(
    {
      cluster: config.cluster,
      pollIntervalMs: config.pollIntervalMs,
      maxHarvestAccounts: config.maxHarvestAccounts,
    },
    'fee-crank worker started',
  );

  app.addHook('onClose', async () => {
    await worker.stop();
  });

  return { app, config };
}

async function main() {
  const { app, config } = await buildServer();
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

const isEntry = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('fee-crank fatal:', err);
    process.exit(1);
  });
}
