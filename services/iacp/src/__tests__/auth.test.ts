import { describe, expect, it } from 'vitest';
import { signAsync, getPublicKeyAsync, hashes, utils } from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { SignJWT } from 'jose';
import bs58 from 'bs58';
import { SESSION_ISSUER } from '@saep/sdk';
import {
  verifySessionToken,
  verifyEnvelopeSignature,
  isEnvelopeTsFresh,
  DEFAULT_MAX_ENVELOPE_AGE_MS,
  DEFAULT_ENVELOPE_CLOCK_SKEW_MS,
} from '../auth.js';
import { canonicalizeForSigning } from '../schema.js';

hashes.sha512 = sha512;

const SECRET = new TextEncoder().encode('test-secret-at-least-32-bytes-long!!');

async function issueSession(address: string, ttlSeconds: number, opts: {
  issuer?: string;
  notBefore?: number;
} = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ address })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(opts.issuer ?? SESSION_ISSUER)
    .setSubject(address)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(SECRET);
}

async function randomAgent(): Promise<string> {
  const sk = utils.randomSecretKey();
  const pk = await getPublicKeyAsync(sk);
  return bs58.encode(pk);
}

describe('verifySessionToken', () => {
  it('accepts a valid portal session JWT', async () => {
    const agent = await randomAgent();
    const token = await issueSession(agent, 60);
    const r = await verifySessionToken(token, SECRET);
    expect(r).not.toBeNull();
    expect(r!.agentPubkey).toBe(agent);
  });

  it('rejects an expired token', async () => {
    const agent = await randomAgent();
    const token = await issueSession(agent, -10);
    expect(await verifySessionToken(token, SECRET)).toBeNull();
  });

  it('rejects a token signed with the wrong secret', async () => {
    const agent = await randomAgent();
    const token = await issueSession(agent, 60);
    const other = new TextEncoder().encode('not-the-real-secret-at-all-xxxxxxxx');
    expect(await verifySessionToken(token, other)).toBeNull();
  });

  it('rejects a token with the wrong issuer', async () => {
    const agent = await randomAgent();
    const token = await issueSession(agent, 60, { issuer: 'attacker.portal' });
    expect(await verifySessionToken(token, SECRET)).toBeNull();
  });

  it('rejects garbage input', async () => {
    expect(await verifySessionToken('not-a-jwt', SECRET)).toBeNull();
    expect(await verifySessionToken('', SECRET)).toBeNull();
  });

  it('rejects a token whose subject is not a valid Solana pubkey', async () => {
    const token = await issueSession('not-base58!!!', 60);
    expect(await verifySessionToken(token, SECRET)).toBeNull();
  });
});

describe('isEnvelopeTsFresh', () => {
  const now = 1_700_000_000_000;

  it('accepts ts equal to now', () => {
    expect(isEnvelopeTsFresh(now, now)).toBe(true);
  });

  it('accepts ts within the default 5min age window', () => {
    expect(isEnvelopeTsFresh(now - (DEFAULT_MAX_ENVELOPE_AGE_MS - 1), now)).toBe(true);
  });

  it('rejects ts older than the default 5min window', () => {
    expect(isEnvelopeTsFresh(now - DEFAULT_MAX_ENVELOPE_AGE_MS - 1, now)).toBe(false);
  });

  it('accepts ts within the default 30s clock-skew window', () => {
    expect(isEnvelopeTsFresh(now + DEFAULT_ENVELOPE_CLOCK_SKEW_MS, now)).toBe(true);
  });

  it('rejects ts further in the future than the skew window', () => {
    expect(isEnvelopeTsFresh(now + DEFAULT_ENVELOPE_CLOCK_SKEW_MS + 1, now)).toBe(false);
  });

  it('rejects negative, NaN, and Infinity', () => {
    expect(isEnvelopeTsFresh(-1, now)).toBe(false);
    expect(isEnvelopeTsFresh(Number.NaN, now)).toBe(false);
    expect(isEnvelopeTsFresh(Number.POSITIVE_INFINITY, now)).toBe(false);
  });

  it('honors per-call overrides', () => {
    expect(isEnvelopeTsFresh(now - 2000, now, { maxAgeMs: 1000 })).toBe(false);
    expect(isEnvelopeTsFresh(now + 2000, now, { maxSkewMs: 5000 })).toBe(true);
  });

  it('rejects seconds-scale ts when now is ms (guards against unit drift)', () => {
    expect(isEnvelopeTsFresh(Math.floor(now / 1000), now)).toBe(false);
  });
});

describe('verifyEnvelopeSignature', () => {
  it('round-trips', async () => {
    const sk = utils.randomSecretKey();
    const pk = await getPublicKeyAsync(sk);
    const agent = bs58.encode(pk);
    const env = {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      topic: `agent.${agent}.inbox`,
      from_agent: agent,
      to_agent: null,
      payload_cid: 'bafy',
      payload_digest: 'a'.repeat(64),
      signature: '',
      ts: Math.floor(Date.now() / 1000),
    };
    const canonical = canonicalizeForSigning(env as never);
    const sig = await signAsync(new TextEncoder().encode(canonical), sk);
    const sigB58 = bs58.encode(sig);
    expect(await verifyEnvelopeSignature(canonical, sigB58, agent)).toBe(true);
    expect(await verifyEnvelopeSignature(canonical + 'x', sigB58, agent)).toBe(false);
  });
});
