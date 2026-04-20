import { describe, expect, it, vi, beforeEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { settle, checkIdempotency, getStatus } from '../settlement.js';
import type { ValidatedPayment } from '../xrpl-listener.js';

vi.mock('../price-oracle.js', () => ({
  convertXrpToLamports: vi.fn().mockResolvedValue(39_285_714n),
}));

function mockPayment(overrides?: Partial<ValidatedPayment>): ValidatedPayment {
  return {
    txHash: 'A'.repeat(64),
    sender: 'rSenderAddress1234567890',
    drops: 10_000_000n,
    solanaPubkey: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    agentDid: 'a'.repeat(32),
    ledgerIndex: 12345678,
    ...overrides,
  };
}

describe('settlement', () => {
  let redis: Redis;

  beforeEach(() => {
    redis = new RedisMock() as unknown as Redis;
  });

  it('settles on localnet and returns result', async () => {
    const payment = mockPayment();
    const result = await settle(redis, payment, 'fake-keypair', 'http://localhost:8899', 'localnet');

    expect(result.txHash).toBe(payment.txHash);
    expect(result.status).toBe('settled');
    expect(typeof result.solTxSig).toBe('string');
    expect(result.solTxSig.length).toBeGreaterThan(0);
    expect(result.lamports).toBe(39_285_714n);
  });

  it('returns same result for duplicate tx hash (idempotency)', async () => {
    const payment = mockPayment();
    const first = await settle(redis, payment, 'fake-keypair', 'http://localhost:8899', 'localnet');
    const second = await settle(redis, payment, 'fake-keypair', 'http://localhost:8899', 'localnet');

    expect(second.solTxSig).toBe(first.solTxSig);
    expect(second.lamports).toBe(first.lamports);
    expect(second.status).toBe(first.status);
  });

  it('settles different tx hashes independently', async () => {
    const a = mockPayment({ txHash: 'A'.repeat(64) });
    const b = mockPayment({ txHash: 'B'.repeat(64) });

    const resultA = await settle(redis, a, 'fake-keypair', 'http://localhost:8899', 'localnet');
    const resultB = await settle(redis, b, 'fake-keypair', 'http://localhost:8899', 'localnet');

    expect(resultA.solTxSig).not.toBe(resultB.solTxSig);
  });

  it('checkIdempotency returns null for unknown hash', async () => {
    const result = await checkIdempotency(redis, 'unknown-hash');
    expect(result).toBeNull();
  });

  it('getStatus returns settlement after settle', async () => {
    const payment = mockPayment();
    await settle(redis, payment, 'fake-keypair', 'http://localhost:8899', 'localnet');

    const status = await getStatus(redis, payment.txHash);
    expect(status).not.toBeNull();
    expect(status!.status).toBe('settled');
  });

  it('getStatus returns null for unprocessed hash', async () => {
    const status = await getStatus(redis, 'never-seen');
    expect(status).toBeNull();
  });

  it('rejects mainnet settlement', async () => {
    const payment = mockPayment({ txHash: 'M'.repeat(64) });
    await expect(
      settle(redis, payment, 'fake-keypair', 'http://localhost:8899', 'mainnet-beta'),
    ).rejects.toThrow('Jito bundle');
  });

  it('produces deterministic sig for same xrpl tx on localnet', async () => {
    const redis2 = new RedisMock() as unknown as Redis;
    const payment = mockPayment();

    const result1 = await settle(redis, payment, 'fake-keypair', 'http://localhost:8899', 'localnet');
    const result2 = await settle(redis2, payment, 'fake-keypair', 'http://localhost:8899', 'localnet');

    expect(result1.solTxSig).toBe(result2.solTxSig);
  });
});
