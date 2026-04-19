import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { LagSampler } from '../lag.js';
import { registry, streamLagSeconds } from '../metrics.js';

const log = pino({ level: 'silent' });

interface PendingFixture {
  count: number;
  oldestId: string | null;
}

class FakeRedis {
  fixtures = new Map<string, PendingFixture | Error>();
  calls: Array<{ topic: string; group: string }> = [];

  async xpending(topic: string, group: string): Promise<unknown[]> {
    this.calls.push({ topic, group });
    const fx = this.fixtures.get(topic);
    if (fx instanceof Error) throw fx;
    if (!fx) return [0, null, null, null];
    return [fx.count, fx.oldestId, fx.oldestId, []];
  }
}

async function getGauge(category: string): Promise<number> {
  const data = await streamLagSeconds.get();
  const sample = data.values.find((v) => v.labels.topic === category);
  return sample?.value ?? -1;
}

describe('LagSampler', () => {
  beforeEach(() => {
    streamLagSeconds.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses oldest stream id (<ms>-<seq>) and reports lag in seconds', async () => {
    const redis = new FakeRedis();
    const now = 1_700_000_010_000;
    redis.fixtures.set('task.aaaa.events', { count: 3, oldestId: '1700000000000-0' });
    const sampler = new LagSampler(redis, 'iacp', () => ['task.aaaa.events'], log, { now: () => now });

    await sampler.tick();

    expect(await getGauge('task_events')).toBe(10);
    expect(await getGauge('agent_inbox')).toBe(0);
  });

  it('aggregates max lag across topics in the same category', async () => {
    const redis = new FakeRedis();
    const now = 1_700_000_030_000;
    redis.fixtures.set('task.aaaa.events', { count: 1, oldestId: '1700000020000-0' });
    redis.fixtures.set('task.bbbb.events', { count: 1, oldestId: '1700000005000-0' });
    const sampler = new LagSampler(
      redis,
      'iacp',
      () => ['task.aaaa.events', 'task.bbbb.events'],
      log,
      { now: () => now },
    );

    await sampler.tick();

    expect(await getGauge('task_events')).toBe(25);
  });

  it('decays gauge to 0 when no pending entries', async () => {
    const redis = new FakeRedis();
    const now = 1_700_000_010_000;
    redis.fixtures.set('task.aaaa.events', { count: 5, oldestId: '1700000000000-0' });
    const sampler = new LagSampler(redis, 'iacp', () => ['task.aaaa.events'], log, { now: () => now });
    await sampler.tick();
    expect(await getGauge('task_events')).toBe(10);

    redis.fixtures.set('task.aaaa.events', { count: 0, oldestId: null });
    await sampler.tick();

    expect(await getGauge('task_events')).toBe(0);
  });

  it('treats NOGROUP as zero-pending, not as an error', async () => {
    const redis = new FakeRedis();
    redis.fixtures.set(
      'task.aaaa.events',
      new Error('NOGROUP No such key or consumer group'),
    );
    const sampler = new LagSampler(
      redis,
      'iacp',
      () => ['task.aaaa.events'],
      log,
      { now: () => 1_700_000_000_000 },
    );

    await sampler.tick();

    expect(await getGauge('task_events')).toBe(0);
  });

  it('skips topic on non-NOGROUP failure but still resets unobserved categories', async () => {
    const redis = new FakeRedis();
    redis.fixtures.set('task.aaaa.events', new Error('CONNRESET'));
    redis.fixtures.set('agent.x.inbox', { count: 1, oldestId: '1700000000000-0' });
    const sampler = new LagSampler(
      redis,
      'iacp',
      () => ['task.aaaa.events', 'agent.x.inbox'],
      log,
      { now: () => 1_700_000_005_000 },
    );

    await sampler.tick();

    expect(await getGauge('task_events')).toBe(0);
    expect(await getGauge('agent_inbox')).toBe(5);
  });

  it('start() / stop() schedule and clear the interval idempotently', () => {
    vi.useFakeTimers();
    const redis = new FakeRedis();
    const sampler = new LagSampler(redis, 'iacp', () => [], log, { intervalMs: 1_000 });

    sampler.start();
    sampler.start();
    vi.advanceTimersByTime(2_500);
    expect(redis.calls.length).toBe(0);

    sampler.stop();
    sampler.stop();
    vi.advanceTimersByTime(5_000);
  });

  it('falls back to 0 lag when stream id is malformed', async () => {
    const redis = new FakeRedis();
    redis.fixtures.set('task.aaaa.events', { count: 1, oldestId: 'garbage' });
    const sampler = new LagSampler(
      redis,
      'iacp',
      () => ['task.aaaa.events'],
      log,
      { now: () => 1_700_000_000_000 },
    );

    await sampler.tick();

    expect(await getGauge('task_events')).toBe(0);
  });

  it('exposes the gauge in the prom-client text output', async () => {
    const redis = new FakeRedis();
    redis.fixtures.set('task.aaaa.events', { count: 1, oldestId: '1700000000000-0' });
    const sampler = new LagSampler(
      redis,
      'iacp',
      () => ['task.aaaa.events'],
      log,
      { now: () => 1_700_000_007_000 },
    );

    await sampler.tick();

    const text = await registry.metrics();
    expect(text).toContain('iacp_stream_lag_seconds');
    expect(text).toMatch(/iacp_stream_lag_seconds\{topic="task_events"\} 7/);
  });

  it('deduplicates topics within a tick', async () => {
    const redis = new FakeRedis();
    redis.fixtures.set('task.aaaa.events', { count: 1, oldestId: '1700000000000-0' });
    const sampler = new LagSampler(
      redis,
      'iacp',
      () => ['task.aaaa.events', 'task.aaaa.events'],
      log,
      { now: () => 1_700_000_001_000 },
    );

    await sampler.tick();

    expect(redis.calls.filter((c) => c.topic === 'task.aaaa.events').length).toBe(1);
  });
});
