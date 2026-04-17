import type { Redis } from 'ioredis';

export type RateResult = { allowed: boolean; remainingMin: number; remainingDay: number };

export async function checkRate(
  redis: Redis,
  agentDid: string,
  perMin: number,
  perDay: number,
): Promise<RateResult> {
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const dayBucket = Math.floor(Date.now() / 86_400_000);
  const minKey = `x402:rl:min:${agentDid}:${minuteBucket}`;
  const dayKey = `x402:rl:day:${agentDid}:${dayBucket}`;

  const luaScript = `
    local count = redis.call('INCR', KEYS[1])
    if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
    return count
  `;

  const [minCount, dayCount] = await Promise.all([
    redis.eval(luaScript, 1, minKey, '120') as Promise<number>,
    redis.eval(luaScript, 1, dayKey, String(86_400 + 3600)) as Promise<number>,
  ]);

  return {
    allowed: minCount <= perMin && dayCount <= perDay,
    remainingMin: Math.max(0, perMin - minCount),
    remainingDay: Math.max(0, perDay - dayCount),
  };
}
