import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import pino from 'pino';
import { Connection } from '@solana/web3.js';
import { loadConfig } from './config.js';
import { registry } from './metrics.js';
import { startWorker } from './worker.js';

export async function buildServer() {
  const config = loadConfig();
  const log = pino({ level: config.logLevel, name: 'buyback-bot' });

  const connection = new Connection(config.rpcUrl, 'confirmed');
  const app = Fastify({ loggerInstance: log });

  app.get('/healthz', async () => ({ status: 'ok', mode: config.mode, cluster: config.cluster }));

  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });

  const worker = startWorker({ connection, config, log });
  worker.start();
  log.info(
    {
      mode: config.mode,
      cluster: config.cluster,
      pollIntervalMs: config.pollIntervalMs,
      swapThresholdUsdcBase: config.swapThresholdUsdc,
      slippageBps: config.slippageBps,
    },
    'buyback worker started',
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
    console.error('buyback-bot fatal:', err);
    process.exit(1);
  });
}

export { fileURLToPath };
