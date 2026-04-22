import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { FastifyInstance } from 'fastify';
import { build } from '../server.js';

vi.mock('../price-oracle.js', () => ({
  convertXrpToLamports: vi.fn().mockResolvedValue(39_285_714n),
}));

describe('xrpl-bridge server', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = build({
      cfg: {
        port: 8788,
        host: '127.0.0.1',
        xrplWsUrl: 'wss://example.invalid',
        xrplBridgeWallet: 'rBridgeWallet12345678901234567',
        solanaRpcUrl: 'http://localhost:8899',
        gatewayKeypair: 'fake-keypair',
        redisUrl: 'redis://127.0.0.1:6379',
        pythEndpoint: 'https://hermes.pyth.network',
        minXrpAmount: 1,
        confirmationLedgers: 4,
        cluster: 'localnet',
      },
      redis: new RedisMock() as any,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns normalized intent fields for XRPL bridge settlements', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/bridge/xrpl',
      payload: {
        tx_hash: 'a'.repeat(64),
        sender: 'rSenderAddress12345678901234567',
        drops: '10000000',
        solana_pubkey: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
        agent_did: 'a'.repeat(32),
        ledger_index: 1234,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      workflow_state: 'settled',
      intent: {
        protocol: 'xrpl-bridge',
        sourceChain: 'xrpl',
        destinationChain: 'solana',
        assetSymbol: 'XRP',
      },
    });
  });
});
