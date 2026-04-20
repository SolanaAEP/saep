import { loadConfig } from './config.js';
import { initOracle } from './price-oracle.js';
import { XrplListener } from './xrpl-listener.js';
import { build } from './server.js';
import { settle } from './settlement.js';
import IORedis from 'ioredis';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const redis = new IORedis(cfg.redisUrl);

  initOracle(cfg.pythEndpoint);

  const app = build({ cfg, redis });

  const listener = new XrplListener({
    wsUrl: cfg.xrplWsUrl,
    bridgeWallet: cfg.xrplBridgeWallet,
    minXrpAmount: cfg.minXrpAmount,
    confirmationLedgers: cfg.confirmationLedgers,
  });

  listener.on('payment', async (payment) => {
    try {
      const result = await settle(
        redis,
        payment,
        cfg.gatewayKeypair,
        cfg.solanaRpcUrl,
        cfg.cluster,
      );
      console.log(`settled xrpl:${payment.txHash} → sol:${result.solTxSig}`);
    } catch (err) {
      console.error(`settlement failed for ${payment.txHash}:`, err);
    }
  });

  listener.on('error', (err) => {
    console.error('xrpl listener error:', err);
  });

  listener.on('connected', () => {
    console.log(`xrpl listener connected, watching ${cfg.xrplBridgeWallet}`);
  });

  await listener.start();
  await app.listen({ port: cfg.port, host: cfg.host });

  const shutdown = async () => {
    await listener.stop();
    await app.close();
    if (redis.status !== 'end') await redis.quit();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
