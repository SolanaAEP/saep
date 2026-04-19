import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import { sessionSecret, verifySessionJwt, SESSION_ISSUER, type SessionPayload } from '../session.js';

const RAW_SECRET = 'test-session-secret-that-is-at-least-32-chars-long';

function secret() {
  return sessionSecret(RAW_SECRET);
}

async function signToken(
  address: string,
  overrides: {
    issuer?: string;
    iat?: number;
    exp?: number;
    sub?: string;
    omitSub?: boolean;
  } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const builder = new SignJWT({ address })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(overrides.issuer ?? SESSION_ISSUER)
    .setIssuedAt(overrides.iat ?? now)
    .setExpirationTime(overrides.exp ?? now + 3600);

  if (!overrides.omitSub) {
    builder.setSubject(overrides.sub ?? address);
  }

  return builder.sign(secret());
}

describe('sessionSecret', () => {
  it('returns Uint8Array for valid input', () => {
    const s = sessionSecret(RAW_SECRET);
    expect(s).toBeInstanceOf(Uint8Array);
    expect(s.length).toBeGreaterThan(0);
  });

  it('throws on undefined', () => {
    expect(() => sessionSecret(undefined)).toThrow('SESSION_SECRET is required');
  });

  it('throws on short secret', () => {
    expect(() => sessionSecret('short')).toThrow('at least 32 characters');
  });

  it('accepts exactly 32 chars', () => {
    expect(() => sessionSecret('a'.repeat(32))).not.toThrow();
  });
});

describe('verifySessionJwt', () => {
  it('returns payload for valid token', async () => {
    const addr = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
    const token = await signToken(addr);
    const result = await verifySessionJwt(token, secret());
    expect(result).not.toBeNull();
    const p = result as SessionPayload;
    expect(p.address).toBe(addr);
    expect(typeof p.issuedAt).toBe('number');
    expect(typeof p.expiresAt).toBe('number');
    expect(p.expiresAt).toBeGreaterThan(p.issuedAt);
  });

  it('returns null for expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    const token = await signToken('addr', { iat: past - 3600, exp: past });
    const result = await verifySessionJwt(token, secret());
    expect(result).toBeNull();
  });

  it('returns null for wrong issuer', async () => {
    const token = await signToken('addr', { issuer: 'wrong.issuer' });
    const result = await verifySessionJwt(token, secret());
    expect(result).toBeNull();
  });

  it('returns null for wrong secret', async () => {
    const token = await signToken('addr');
    const wrongSecret = sessionSecret('different-secret-that-is-32-chars-long');
    const result = await verifySessionJwt(token, wrongSecret);
    expect(result).toBeNull();
  });

  it('returns null for garbage token', async () => {
    const result = await verifySessionJwt('not.a.jwt', secret());
    expect(result).toBeNull();
  });

  it('returns null when sub is missing', async () => {
    const token = await signToken('addr', { omitSub: true });
    const result = await verifySessionJwt(token, secret());
    expect(result).toBeNull();
  });

  it('accepts custom issuer override', async () => {
    const customIssuer = 'custom.issuer';
    const token = await signToken('addr', { issuer: customIssuer });
    const result = await verifySessionJwt(token, secret(), { issuer: customIssuer });
    expect(result).not.toBeNull();
    expect(result!.address).toBe('addr');
  });
});
