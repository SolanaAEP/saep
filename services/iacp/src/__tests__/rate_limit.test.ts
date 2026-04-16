import { describe, expect, it } from 'vitest';
import {
  KeyedRateLimiter,
  TokenBucket,
  buildBandwidthLimiter,
  buildMsgLimiter,
  defaultLimiterConfig,
} from '../rate_limit.js';

describe('TokenBucket', () => {
  const bucket = new TokenBucket({ capacity: 10, refillPerMs: 0.01 });

  it('rejects invalid construction', () => {
    expect(() => new TokenBucket({ capacity: 0, refillPerMs: 1 })).toThrow();
    expect(() => new TokenBucket({ capacity: 1, refillPerMs: 0 })).toThrow();
  });

  it('starts full', () => {
    const s = bucket.initial(0);
    expect(s.tokens).toBe(10);
  });

  it('consumes and rejects when empty', () => {
    const s = bucket.initial(0);
    for (let i = 0; i < 10; i++) expect(bucket.tryConsume(s, 0)).toBe(true);
    expect(bucket.tryConsume(s, 0)).toBe(false);
    expect(s.tokens).toBe(0);
  });

  it('refills continuously', () => {
    const s = bucket.initial(0);
    for (let i = 0; i < 10; i++) bucket.tryConsume(s, 0);
    expect(bucket.tryConsume(s, 0)).toBe(false);
    expect(bucket.tryConsume(s, 100)).toBe(true);
    expect(bucket.tryConsume(s, 100)).toBe(false);
  });

  it('caps at capacity on long idle', () => {
    const s = bucket.initial(0);
    bucket.refill(s, 10_000_000);
    expect(s.tokens).toBe(10);
  });

  it('reports accurate retryAfterMs when empty', () => {
    const s = bucket.initial(0);
    for (let i = 0; i < 10; i++) bucket.tryConsume(s, 0);
    expect(bucket.retryAfterMs(s, 0, 1)).toBe(100);
    expect(bucket.retryAfterMs(s, 0, 5)).toBe(500);
  });

  it('retryAfterMs is 0 when allowed', () => {
    const s = bucket.initial(0);
    expect(bucket.retryAfterMs(s, 0, 1)).toBe(0);
  });

  it('supports variable-cost consumption (bandwidth)', () => {
    const bw = new TokenBucket({ capacity: 1000, refillPerMs: 1 });
    const s = bw.initial(0);
    expect(bw.tryConsume(s, 0, 600)).toBe(true);
    expect(bw.tryConsume(s, 0, 500)).toBe(false);
    expect(bw.tryConsume(s, 0, 400)).toBe(true);
  });
});

describe('KeyedRateLimiter', () => {
  it('buckets are per-key', () => {
    const rl = new KeyedRateLimiter({ capacity: 2, refillPerMs: 0.001 });
    expect(rl.consume('a', 1, 0).allowed).toBe(true);
    expect(rl.consume('a', 1, 0).allowed).toBe(true);
    expect(rl.consume('a', 1, 0).allowed).toBe(false);
    expect(rl.consume('b', 1, 0).allowed).toBe(true);
  });

  it('reports size and supports manual delete', () => {
    const rl = new KeyedRateLimiter({ capacity: 1, refillPerMs: 0.001 });
    rl.consume('a', 1, 0);
    rl.consume('b', 1, 0);
    expect(rl.size()).toBe(2);
    rl.delete('a');
    expect(rl.size()).toBe(1);
  });

  it('sweeps only idle, fully-refilled buckets', () => {
    const rl = new KeyedRateLimiter({ capacity: 10, refillPerMs: 0.1, idleMs: 1000 });
    rl.consume('cold', 5, 0);
    rl.consume('recent', 5, 0);
    // At t=500 both have refilled to full (+50 tokens → capped at 10).
    // 'recent' is touched again, resetting lastConsumed.
    rl.consume('recent', 1, 500);
    // Advance past idle threshold (>1000ms past each key's last consume).
    const dropped = rl.sweep(2000);
    // 'cold': last consumed at t=0, now t=2000, tokens back to 10 — swept.
    // 'recent': last consumed at t=500, now t=2000, 1500ms since consume, tokens=10 — swept.
    expect(dropped).toBe(2);
    expect(rl.size()).toBe(0);
  });

  it('sweep does not drop buckets whose last consume is within idle window', () => {
    const rl = new KeyedRateLimiter({ capacity: 10, refillPerMs: 0.1, idleMs: 10_000 });
    rl.consume('k', 1, 0);
    // At t=5s the bucket has refilled to full (+500 capped at 10) but last consume was 5s ago — idle window is 10s.
    expect(rl.sweep(5_000)).toBe(0);
    expect(rl.size()).toBe(1);
  });

  it('evicts oldest key when maxKeys exceeded', () => {
    const rl = new KeyedRateLimiter({ capacity: 1, refillPerMs: 0.001, maxKeys: 2 });
    rl.consume('a', 1, 0);
    rl.consume('b', 1, 0);
    rl.consume('c', 1, 0);
    expect(rl.size()).toBe(2);
  });

  it('retryAfterMs monotonically drains toward 0 as time advances', () => {
    const rl = new KeyedRateLimiter({ capacity: 1, refillPerMs: 0.001 });
    rl.consume('a', 1, 0);
    const r1 = rl.consume('a', 1, 0);
    expect(r1.allowed).toBe(false);
    expect(r1.retryAfterMs).toBe(1000);
    const r2 = rl.consume('a', 1, 500);
    expect(r2.allowed).toBe(false);
    expect(r2.retryAfterMs).toBe(500);
    const r3 = rl.consume('a', 1, 1000);
    expect(r3.allowed).toBe(true);
  });
});

describe('default limiter builders', () => {
  it('msg limiter caps at 20 burst', () => {
    const rl = buildMsgLimiter();
    for (let i = 0; i < defaultLimiterConfig.msgBurst; i++) {
      expect(rl.consume('pk', 1, 0).allowed).toBe(true);
    }
    expect(rl.consume('pk', 1, 0).allowed).toBe(false);
  });

  it('bw limiter caps at 256KiB burst', () => {
    const rl = buildBandwidthLimiter();
    expect(rl.consume('sock', 256 * 1024, 0).allowed).toBe(true);
    expect(rl.consume('sock', 1, 0).allowed).toBe(false);
  });

  it('msg limiter sustained = 5/s', () => {
    const rl = buildMsgLimiter();
    for (let i = 0; i < defaultLimiterConfig.msgBurst; i++) rl.consume('pk', 1, 0);
    // After 200ms (1/5s) one more token should be available.
    expect(rl.consume('pk', 1, 200).allowed).toBe(true);
    expect(rl.consume('pk', 1, 200).allowed).toBe(false);
  });
});
