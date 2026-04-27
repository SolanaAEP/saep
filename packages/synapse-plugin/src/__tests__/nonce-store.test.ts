import { describe, expect, it } from 'vitest';
import { MemoryNonceStore } from '../nonce-store.js';
import type { NonceEntry } from '../types.js';

function entry(taskAddress: string): NonceEntry {
  return {
    taskAddress,
    taskIdHex: 'aa'.repeat(32),
    agentDidHex: 'bb'.repeat(32),
    amountUsdcMicro: 500_000,
    nonceHex: 'cc'.repeat(32),
    createdAt: Date.now(),
  };
}

describe('MemoryNonceStore', () => {
  it('save and get', async () => {
    const store = new MemoryNonceStore();
    const e = entry('task1');
    await store.save(e);
    const got = await store.get('task1');
    expect(got).toEqual(e);
  });

  it('returns null for missing key', async () => {
    const store = new MemoryNonceStore();
    expect(await store.get('missing')).toBeNull();
  });

  it('delete removes entry', async () => {
    const store = new MemoryNonceStore();
    await store.save(entry('task1'));
    await store.delete('task1');
    expect(await store.get('task1')).toBeNull();
  });

  it('list returns all entries', async () => {
    const store = new MemoryNonceStore();
    await store.save(entry('task1'));
    await store.save(entry('task2'));
    const all = await store.list();
    expect(all.length).toBe(2);
  });

  it('save overwrites existing entry for same task', async () => {
    const store = new MemoryNonceStore();
    await store.save(entry('task1'));
    const e2 = { ...entry('task1'), amountUsdcMicro: 1_000_000 };
    await store.save(e2);
    const got = await store.get('task1');
    expect(got?.amountUsdcMicro).toBe(1_000_000);
    expect((await store.list()).length).toBe(1);
  });
});
