import { describe, expect, it } from 'vitest';
import { ClientFrameSchema, EnvelopeSchema } from '../schema.js';

const validEnv = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  topic: 'broadcast.health',
  from_agent: '1'.repeat(43),
  to_agent: null,
  payload_cid: 'bafy',
  payload_digest: 'a'.repeat(64),
  signature: 'sig',
  ts: 0,
};

describe('EnvelopeSchema', () => {
  it('accepts valid envelope', () => {
    expect(EnvelopeSchema.safeParse(validEnv).success).toBe(true);
  });

  it('rejects bad topic', () => {
    expect(
      EnvelopeSchema.safeParse({ ...validEnv, topic: 'not-a-topic' }).success,
    ).toBe(false);
  });

  it('rejects short digest', () => {
    expect(
      EnvelopeSchema.safeParse({ ...validEnv, payload_digest: 'abc' }).success,
    ).toBe(false);
  });
});

describe('ClientFrameSchema', () => {
  it('parses sub frame', () => {
    const r = ClientFrameSchema.safeParse({ type: 'sub', topic: 'broadcast.health' });
    expect(r.success).toBe(true);
  });

  it('rejects unknown type', () => {
    expect(ClientFrameSchema.safeParse({ type: 'bogus' }).success).toBe(false);
  });
});
