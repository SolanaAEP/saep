import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { Keypair, PublicKey } from '@solana/web3.js';
import { RpcAgentLookup, agentLookupOffsets } from '../agents.js';

const log = pino({ level: 'silent' });
const programId = new PublicKey('EQJ4Lp2gxJDD5hs185aDcermYWdAi4cQeSKfnuqLAQYu');

function stubConnection(
  impl: (filterBytes: string) => Array<{ pubkey: PublicKey; account: { data: Buffer } }>,
) {
  const getProgramAccounts = vi.fn(async (_pid: PublicKey, config: Record<string, unknown>) => {
    const filters = config.filters as Array<{ memcmp: { bytes: string } }>;
    const bytes = filters[0]!.memcmp.bytes;
    return impl(bytes);
  });
  return { getProgramAccounts } as unknown as import('@solana/web3.js').Connection;
}

describe('RpcAgentLookup', () => {
  it('returns true when any AgentAccount for the operator is Active', async () => {
    const operator = Keypair.generate().publicKey.toBase58();
    const conn = stubConnection((bytes) => {
      expect(bytes).toBe(operator);
      return [
        { pubkey: Keypair.generate().publicKey, account: { data: Buffer.from([agentLookupOffsets.STATUS_ACTIVE]) } },
      ];
    });
    const lookup = new RpcAgentLookup(conn, programId, log);
    expect(await lookup.isActiveOperator(operator)).toBe(true);
  });

  it('returns false when no AgentAccount matches', async () => {
    const operator = Keypair.generate().publicKey.toBase58();
    const conn = stubConnection(() => []);
    const lookup = new RpcAgentLookup(conn, programId, log);
    expect(await lookup.isActiveOperator(operator)).toBe(false);
  });

  it('returns false when all matches are non-Active', async () => {
    const operator = Keypair.generate().publicKey.toBase58();
    const conn = stubConnection(() => [
      { pubkey: Keypair.generate().publicKey, account: { data: Buffer.from([1]) } }, // Paused
      { pubkey: Keypair.generate().publicKey, account: { data: Buffer.from([3]) } }, // Deregistered
    ]);
    const lookup = new RpcAgentLookup(conn, programId, log);
    expect(await lookup.isActiveOperator(operator)).toBe(false);
  });

  it('rejects garbage pubkey without hitting RPC', async () => {
    const getProgramAccounts = vi.fn();
    const conn = { getProgramAccounts } as unknown as import('@solana/web3.js').Connection;
    const lookup = new RpcAgentLookup(conn, programId, log);
    expect(await lookup.isActiveOperator('not-base58!!!')).toBe(false);
    expect(getProgramAccounts).not.toHaveBeenCalled();
  });

  it('caches positive results for the TTL', async () => {
    const operator = Keypair.generate().publicKey.toBase58();
    const getProgramAccounts = vi.fn(async () => [
      { pubkey: Keypair.generate().publicKey, account: { data: Buffer.from([agentLookupOffsets.STATUS_ACTIVE]) } },
    ]);
    const conn = { getProgramAccounts } as unknown as import('@solana/web3.js').Connection;
    const lookup = new RpcAgentLookup(conn, programId, log, { positiveTtlMs: 1_000 });

    const t0 = 1_000_000;
    expect(await lookup.isActiveOperator(operator, t0)).toBe(true);
    expect(await lookup.isActiveOperator(operator, t0 + 500)).toBe(true);
    expect(getProgramAccounts).toHaveBeenCalledTimes(1);

    expect(await lookup.isActiveOperator(operator, t0 + 1_500)).toBe(true);
    expect(getProgramAccounts).toHaveBeenCalledTimes(2);
  });

  it('caches negative results with a shorter TTL', async () => {
    const operator = Keypair.generate().publicKey.toBase58();
    const getProgramAccounts = vi.fn(async () => []);
    const conn = { getProgramAccounts } as unknown as import('@solana/web3.js').Connection;
    const lookup = new RpcAgentLookup(conn, programId, log, {
      positiveTtlMs: 60_000,
      negativeTtlMs: 500,
    });
    const t0 = 5_000_000;
    expect(await lookup.isActiveOperator(operator, t0)).toBe(false);
    expect(await lookup.isActiveOperator(operator, t0 + 100)).toBe(false);
    expect(getProgramAccounts).toHaveBeenCalledTimes(1);
    expect(await lookup.isActiveOperator(operator, t0 + 700)).toBe(false);
    expect(getProgramAccounts).toHaveBeenCalledTimes(2);
  });

  it('does not cache RPC errors (retries on next call)', async () => {
    const operator = Keypair.generate().publicKey.toBase58();
    let calls = 0;
    const getProgramAccounts = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error('rpc boom');
      return [
        { pubkey: Keypair.generate().publicKey, account: { data: Buffer.from([agentLookupOffsets.STATUS_ACTIVE]) } },
      ];
    });
    const conn = { getProgramAccounts } as unknown as import('@solana/web3.js').Connection;
    const lookup = new RpcAgentLookup(conn, programId, log);
    expect(await lookup.isActiveOperator(operator)).toBe(false);
    expect(await lookup.isActiveOperator(operator)).toBe(true);
    expect(getProgramAccounts).toHaveBeenCalledTimes(2);
  });

  it('evicts oldest entry when maxEntries reached', async () => {
    const getProgramAccounts = vi.fn(async () => []);
    const conn = { getProgramAccounts } as unknown as import('@solana/web3.js').Connection;
    const lookup = new RpcAgentLookup(conn, programId, log, { maxEntries: 2 });
    const a = Keypair.generate().publicKey.toBase58();
    const b = Keypair.generate().publicKey.toBase58();
    const c = Keypair.generate().publicKey.toBase58();
    await lookup.isActiveOperator(a);
    await lookup.isActiveOperator(b);
    expect(lookup.size()).toBe(2);
    await lookup.isActiveOperator(c);
    expect(lookup.size()).toBe(2);
  });

  it('invalidate clears a single entry', async () => {
    const operator = Keypair.generate().publicKey.toBase58();
    const getProgramAccounts = vi.fn(async () => []);
    const conn = { getProgramAccounts } as unknown as import('@solana/web3.js').Connection;
    const lookup = new RpcAgentLookup(conn, programId, log);
    await lookup.isActiveOperator(operator);
    expect(lookup.size()).toBe(1);
    lookup.invalidate(operator);
    expect(lookup.size()).toBe(0);
  });

  it('passes the correct memcmp offset and dataSlice', async () => {
    const operator = Keypair.generate().publicKey.toBase58();
    const getProgramAccounts = vi.fn(async () => []);
    const conn = { getProgramAccounts } as unknown as import('@solana/web3.js').Connection;
    const lookup = new RpcAgentLookup(conn, programId, log);
    await lookup.isActiveOperator(operator);
    expect(getProgramAccounts).toHaveBeenCalledWith(
      programId,
      expect.objectContaining({
        commitment: 'confirmed',
        dataSlice: { offset: agentLookupOffsets.STATUS_OFFSET, length: 1 },
        filters: [
          { memcmp: { offset: agentLookupOffsets.OPERATOR_OFFSET, bytes: operator } },
        ],
      }),
    );
  });
});
