import { describe, expect, it } from 'vitest';
import { TopicRing } from '../ring.js';
import type { Envelope } from '../schema.js';

const mkEnv = (i: number): Envelope => ({
  id: String(i).padStart(26, '0'),
  topic: 'system.test',
  from_agent: '1'.repeat(32),
  to_agent: null,
  payload_cid: 'bafy' + i,
  payload_digest: 'a'.repeat(64),
  signature: 's',
  ts: i,
});

describe('TopicRing', () => {
  it('stores up to capacity and evicts oldest', () => {
    const r = new TopicRing(3);
    for (let i = 0; i < 5; i++) r.push('t', mkEnv(i), String(i));
    const recent = r.recent('t', 10);
    expect(recent.map((e) => e.envelope.ts)).toEqual([2, 3, 4]);
  });

  it('empty topic returns []', () => {
    const r = new TopicRing(3);
    expect(r.recent('missing')).toEqual([]);
  });

  it('respects limit arg', () => {
    const r = new TopicRing(10);
    for (let i = 0; i < 5; i++) r.push('t', mkEnv(i), String(i));
    expect(r.recent('t', 2).length).toBe(2);
  });

  it('topics() lists keys', () => {
    const r = new TopicRing(3);
    r.push('a', mkEnv(1), '1');
    r.push('b', mkEnv(2), '2');
    expect(r.topics().sort()).toEqual(['a', 'b']);
  });
});
