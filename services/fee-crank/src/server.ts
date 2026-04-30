import Fastify from 'fastify';
import pino from 'pino';
import { loadConfig } from './config.js';
import { registry } from './metrics.js';
import { startWorker } from './worker.js';
import { createPool } from './db.js';
import { registerProofRoutes } from './proof-api.js';

export async function buildServer() {
  const config = loadConfig();
  const log = pino({ level: config.logLevel, name: 'fee-crank' });

  const db = config.databaseUrl ? await createPool(config.databaseUrl) : null;
  if (db) {
    log.info('snapshot database connected');
  } else {
    log.warn('DATABASE_URL not set — snapshot oracle disabled');
  }

  const app = Fastify({ loggerInstance: log });

  app.get('/healthz', async () => ({ status: 'ok', cluster: config.cluster }));

  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });

  if (db) {
    registerProofRoutes(app as never, db);
  }

  const worker = startWorker({ config, log, db });
  worker.start();
  log.info(
    {
      cluster: config.cluster,
      pollIntervalMs: config.pollIntervalMs,
      maxHarvestAccounts: config.maxHarvestAccounts,
      snapshotOracle: Boolean(db),
    },
    'fee-crank worker started',
  );

  app.addHook('onClose', async () => {
    await worker.stop();
    if (db) await db.end();
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
