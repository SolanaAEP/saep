import { describe, it, expect, beforeEach, vi } from 'vitest';
import pino from 'pino';
import { StreamBus } from '../streams.js';
import type { Envelope } from '../schema.js';

const log = pino({ level: 'silent' });

const SAMPLE_FROM = 'A'.repeat(44);
const SAMPLE_DIGEST = '0'.repeat(64);
const SAMPLE_ID = 'A'.repeat(26);

function envelope(overrides: Partial<Envelope> = {}): Envelope {
  return {
    id: SAMPLE_ID,
    topic: 'task:abc',
    from_agent: SAMPLE_FROM,
    to_agent: null,
    payload_cid: 'bafyabc',
    payload_digest: SAMPLE_DIGEST,
    signature: 'sig',
    ts: Date.now(),
    ...overrides,
  };
}

function makeRedis() {
  return {
    xgroup: vi.fn().mockResolvedValue('OK'),
    xadd: vi.fn().mockResolvedValue('1700000000000-0'),
    xreadgroup: vi.fn().mockResolvedValue(null),
    xack: vi.fn().mockResolvedValue(1),
    xtrim: vi.fn().mockResolvedValue(0),
  };
}

describe('StreamBus', () => {
  let redis: ReturnType<typeof makeRedis>;
  let bus: StreamBus;

  beforeEach(() => {
    redis = makeRedis();
    bus = new StreamBus(redis as any, 'test-group', 'test-consumer', log);
  });

  it('ensureGroup invokes xgroup CREATE with MKSTREAM and the configured group name', async () => {
    await bus.ensureGroup('task:abc');
    expect(redis.xgroup).toHaveBeenCalledWith('CREATE', 'task:abc', 'test-group', '$', 'MKSTREAM');
  });

  it('ensureGroup swallows BUSYGROUP — second create is a no-op upstream of caller', async () => {
    redis.xgroup.mockRejectedValueOnce(new Error('BUSYGROUP Consumer Group name already exists'));
    await expect(bus.ensureGroup('task:abc')).resolves.not.toThrow();
  });

  it('ensureGroup propagates any non-BUSYGROUP error', async () => {
    redis.xgroup.mockRejectedValueOnce(new Error('connection refused'));
    await expect(bus.ensureGroup('task:abc')).rejects.toThrow('connection refused');
  });

  it('publish forwards to xadd with MAXLEN ~ default and serialised envelope', async () => {
    const env = envelope();
    const id = await bus.publish(env);
    expect(redis.xadd).toHaveBeenCalledWith(
      'task:abc',
      'MAXLEN',
      '~',
      '50000',
      '*',
      'env',
      JSON.stringify(env),
    );
    expect(id).toBe('1700000000000-0');
  });

  it('publish honours a custom maxLen override', async () => {
    await bus.publish(envelope(), 1_000);
    expect(redis.xadd).toHaveBeenCalledWith(
      'task:abc',
      'MAXLEN',
      '~',
      '1000',
      '*',
      'env',
      expect.any(String),
    );
  });

  it('read short-circuits to [] for an empty topic list', async () => {
    expect(await bus.read([], 50, 16)).toEqual([]);
    expect(redis.xreadgroup).not.toHaveBeenCalled();
  });

  it('read returns [] when xreadgroup yields null (no entries within block window)', async () => {
    redis.xreadgroup.mockResolvedValueOnce(null);
    expect(await bus.read(['task:abc'], 50, 16)).toEqual([]);
  });

  it('read parses entries and surfaces topic + streamId + envelope', async () => {
    const env = envelope({ payload_cid: 'bafyhello' });
    redis.xreadgroup.mockResolvedValueOnce([
      ['task:abc', [['1700000000000-0', ['env', JSON.stringify(env)]]]],
    ]);

    const messages = await bus.read(['task:abc'], 50, 16);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.streamId).toBe('1700000000000-0');
    expect(messages[0]!.topic).toBe('task:abc');
    expect(messages[0]!.envelope.payload_cid).toBe('bafyhello');
  });

  it('read passes group / consumer / count / block / topic > markers through to xreadgroup', async () => {
    redis.xreadgroup.mockResolvedValueOnce(null);
    await bus.read(['t1', 't2'], 5_000, 32);
    expect(redis.xreadgroup).toHaveBeenCalledWith(
      'GROUP',
      'test-group',
      'test-consumer',
      'COUNT',
      '32',
      'BLOCK',
      '5000',
      'STREAMS',
      't1',
      't2',
      '>',
      '>',
    );
  });

  it('read skips malformed entries instead of throwing', async () => {
    redis.xreadgroup.mockResolvedValueOnce([
      ['task:abc', [
        ['1-0', ['env', 'not-json']],
        ['2-0', ['env', JSON.stringify(envelope({ payload_cid: 'bafyok' }))]],
      ]],
    ]);
    const messages = await bus.read(['task:abc'], 50, 16);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.streamId).toBe('2-0');
    expect(messages[0]!.envelope.payload_cid).toBe('bafyok');
  });

  it('ack forwards topic + group + streamId to xack', async () => {
    await bus.ack('task:abc', '1-0');
    expect(redis.xack).toHaveBeenCalledWith('task:abc', 'test-group', '1-0');
  });

  it('trim forwards MAXLEN ~ to xtrim and returns the numeric reply', async () => {
    redis.xtrim.mockResolvedValueOnce(7);
    const trimmed = await bus.trim('task:abc', 100);
    expect(redis.xtrim).toHaveBeenCalledWith('task:abc', 'MAXLEN', '~', 100);
    expect(trimmed).toBe(7);
  });
});
