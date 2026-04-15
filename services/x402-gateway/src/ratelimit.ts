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

  const [minCount, dayCount] = await Promise.all([
    redis.incr(minKey),
    redis.incr(dayKey),
  ]);
  if (minCount === 1) await redis.expire(minKey, 120);
  if (dayCount === 1) await redis.expire(dayKey, 86_400 + 3600);

  return {
    allowed: minCount <= perMin && dayCount <= perDay,
    remainingMin: Math.max(0, perMin - minCount),
    remainingDay: Math.max(0, perDay - dayCount),
  };
}
