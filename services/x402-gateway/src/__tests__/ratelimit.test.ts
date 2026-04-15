import { afterEach, describe, expect, it } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { checkRate } from '../ratelimit.js';

describe('ratelimit', () => {
  const redis = new RedisMock() as unknown as Redis;

  afterEach(async () => {
    await redis.flushall();
  });

  it('allows under perMin cap', async () => {
    const a = await checkRate(redis, 'agent1', 3, 100);
    expect(a.allowed).toBe(true);
    expect(a.remainingMin).toBe(2);
  });

  it('blocks above perMin cap', async () => {
    for (let i = 0; i < 3; i++) await checkRate(redis, 'agent2', 3, 100);
    const blocked = await checkRate(redis, 'agent2', 3, 100);
    expect(blocked.allowed).toBe(false);
  });

  it('independent per agent_did', async () => {
    for (let i = 0; i < 3; i++) await checkRate(redis, 'agentA', 3, 100);
    const other = await checkRate(redis, 'agentB', 3, 100);
    expect(other.allowed).toBe(true);
  });
});
