// Token-bucket limiter. One bucket per key; refills continuously at `refillPerMs`
// tokens per millisecond up to `capacity`. `tryConsume` returns false (and does
// not deduct) when the bucket has fewer than `amount` tokens.
//
// Two shapes are instantiated at boot:
//   1. per-agent message bucket   — amount = 1 per publish
//   2. per-socket byte bucket     — amount = envelope byte length per publish
//
// Idle sweep reclaims buckets that have been at full capacity for longer than
// `idleMs` so long-lived processes don't accumulate keys indefinitely.

export interface TokenBucketOptions {
  capacity: number;
  refillPerMs: number;
}

interface BucketState {
  tokens: number;
  lastRefill: number;
  lastConsumed: number;
}

export class TokenBucket {
  readonly capacity: number;
  readonly refillPerMs: number;

  constructor(opts: TokenBucketOptions) {
    if (opts.capacity <= 0) throw new Error('capacity must be > 0');
    if (opts.refillPerMs <= 0) throw new Error('refillPerMs must be > 0');
    this.capacity = opts.capacity;
    this.refillPerMs = opts.refillPerMs;
  }

  initial(now: number): BucketState {
    return { tokens: this.capacity, lastRefill: now, lastConsumed: now };
  }

  refill(state: BucketState, now: number): void {
    if (now <= state.lastRefill) return;
    const elapsed = now - state.lastRefill;
    state.tokens = Math.min(this.capacity, state.tokens + elapsed * this.refillPerMs);
    state.lastRefill = now;
  }

  tryConsume(state: BucketState, now: number, amount = 1): boolean {
    this.refill(state, now);
    if (state.tokens < amount) return false;
    state.tokens -= amount;
    if (amount > 0) state.lastConsumed = now;
    return true;
  }

  retryAfterMs(state: BucketState, now: number, amount = 1): number {
    this.refill(state, now);
    const deficit = amount - state.tokens;
    if (deficit <= 0) return 0;
    return Math.ceil(deficit / this.refillPerMs);
  }

  isIdle(state: BucketState, now: number, idleMs: number): boolean {
    this.refill(state, now);
    return state.tokens >= this.capacity && now - state.lastConsumed >= idleMs;
  }
}

export interface RateLimiterOptions extends TokenBucketOptions {
  idleMs?: number;
  maxKeys?: number;
}

export interface ConsumeResult {
  allowed: boolean;
  retryAfterMs: number;
}

// Keyed rate limiter. Buckets are created lazily, swept when full for `idleMs`.
// Eviction on overflow drops the oldest insertion — acceptable for per-agent and
// per-socket scopes where adversarial flooding doesn't change who gets throttled
// (the attacker's own bucket stays hot; idle victims get evicted harmlessly).
export class KeyedRateLimiter {
  private readonly bucket: TokenBucket;
  private readonly states = new Map<string, BucketState>();
  private readonly idleMs: number;
  private readonly maxKeys: number;

  constructor(opts: RateLimiterOptions) {
    this.bucket = new TokenBucket(opts);
    this.idleMs = opts.idleMs ?? 60_000;
    this.maxKeys = opts.maxKeys ?? 10_000;
  }

  consume(key: string, amount = 1, now: number = Date.now()): ConsumeResult {
    const state = this.getOrCreate(key, now);
    const allowed = this.bucket.tryConsume(state, now, amount);
    const retryAfterMs = allowed ? 0 : this.bucket.retryAfterMs(state, now, amount);
    return { allowed, retryAfterMs };
  }

  delete(key: string): void {
    this.states.delete(key);
  }

  sweep(now: number = Date.now()): number {
    let dropped = 0;
    for (const [key, state] of this.states) {
      if (this.bucket.isIdle(state, now, this.idleMs)) {
        this.states.delete(key);
        dropped++;
      }
    }
    return dropped;
  }

  size(): number {
    return this.states.size;
  }

  private getOrCreate(key: string, now: number): BucketState {
    let state = this.states.get(key);
    if (!state) {
      if (this.states.size >= this.maxKeys) {
        const oldest = this.states.keys().next().value;
        if (oldest !== undefined) this.states.delete(oldest);
      }
      state = this.bucket.initial(now);
      this.states.set(key, state);
    }
    return state;
  }
}

export const DEFAULT_MSG_BURST = 20;
export const DEFAULT_MSG_SUSTAINED_PER_S = 5;
export const DEFAULT_BW_BURST_BYTES = 256 * 1024;
export const DEFAULT_BW_SUSTAINED_BYTES_PER_S = 64 * 1024;

export interface LimiterConfig {
  msgBurst: number;
  msgSustainedPerS: number;
  bwBurstBytes: number;
  bwSustainedBytesPerS: number;
}

export const defaultLimiterConfig: LimiterConfig = {
  msgBurst: DEFAULT_MSG_BURST,
  msgSustainedPerS: DEFAULT_MSG_SUSTAINED_PER_S,
  bwBurstBytes: DEFAULT_BW_BURST_BYTES,
  bwSustainedBytesPerS: DEFAULT_BW_SUSTAINED_BYTES_PER_S,
};

export function buildMsgLimiter(cfg: LimiterConfig = defaultLimiterConfig): KeyedRateLimiter {
  return new KeyedRateLimiter({
    capacity: cfg.msgBurst,
    refillPerMs: cfg.msgSustainedPerS / 1000,
  });
}

export function buildBandwidthLimiter(cfg: LimiterConfig = defaultLimiterConfig): KeyedRateLimiter {
  return new KeyedRateLimiter({
    capacity: cfg.bwBurstBytes,
    refillPerMs: cfg.bwSustainedBytesPerS / 1000,
  });
}
