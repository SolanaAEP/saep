import { describe, it, expect, vi, beforeEach } from 'vitest';

const cookieStore = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => {
      const v = cookieStore.get(name);
      return v ? { name, value: v } : undefined;
    },
    set: (name: string, value: string) => cookieStore.set(name, value),
    delete: (name: string) => cookieStore.delete(name),
  }),
}));

function makeRequest(url: string, opts: { method?: string; body?: unknown; cookies?: Record<string, string> } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  const reqCookies = new Map<string, { name: string; value: string }>();
  if (opts.cookies) {
    for (const [k, v] of Object.entries(opts.cookies)) {
      reqCookies.set(k, { name: k, value: v });
    }
  }

  return {
    url,
    method: opts.method ?? 'POST',
    headers,
    json: async () => opts.body ?? null,
    cookies: {
      get: (name: string) => reqCookies.get(name),
    },
  } as never;
}

const TEST_SECRET = 'test-session-secret-that-is-at-least-32-chars-long';

beforeEach(() => {
  cookieStore.clear();
  process.env.SESSION_SECRET = TEST_SECRET;
});

describe('POST /api/auth/nonce', () => {
  it('returns 400 without address', async () => {
    const { POST } = await import('../app/api/auth/nonce/route.js');
    const req = makeRequest('http://localhost:3000/api/auth/nonce', { body: {} });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/address/i);
  });

  it('returns SIWS message + nonceToken for valid address', async () => {
    const { POST } = await import('../app/api/auth/nonce/route.js');
    const address = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
    const req = makeRequest('http://localhost:3000/api/auth/nonce', { body: { address } });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message.address).toBe(address);
    expect(data.message.domain).toBe('localhost:3000');
    expect(data.message.nonce).toBeTruthy();
    expect(data.message.version).toBe('1');
    expect(data.nonceToken).toBeTruthy();
  });

  it('sets saep_nonce cookie', async () => {
    const { POST } = await import('../app/api/auth/nonce/route.js');
    const req = makeRequest('http://localhost:3000/api/auth/nonce', {
      body: { address: 'addr' },
    });
    const res = await POST(req);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('saep_nonce=');
  });
});

describe('POST /api/auth/verify', () => {
  it('returns 400 without message or signature', async () => {
    const { POST } = await import('../app/api/auth/verify/route.js');
    const req = makeRequest('http://localhost:3000/api/auth/verify', { body: {} });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 401 without nonce cookie', async () => {
    const { POST } = await import('../app/api/auth/verify/route.js');
    const req = makeRequest('http://localhost:3000/api/auth/verify', {
      body: {
        message: { nonce: 'x', address: 'y', domain: 'z', expirationTime: new Date().toISOString() },
        signature: 'dGVzdA==',
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toMatch(/nonce/i);
  });
});

describe('GET /api/auth/me', () => {
  it('returns null session without cookie', async () => {
    const { GET } = await import('../app/api/auth/me/route.js');
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.session).toBeNull();
  });

  it('returns session for valid cookie', async () => {
    const { SignJWT } = await import('jose');
    const { SESSION_ISSUER, sessionSecret } = await import('@saep/sdk');
    const address = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ address })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(SESSION_ISSUER)
      .setSubject(address)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(sessionSecret(TEST_SECRET));
    cookieStore.set('saep_session', token);

    const { GET } = await import('../app/api/auth/me/route.js');
    const res = await GET();
    const data = await res.json();
    expect(data.session).not.toBeNull();
    expect(data.session.address).toBe(address);
    expect(data.session.expiresAt).toBeTruthy();
  });

  it('returns null for expired session cookie', async () => {
    const { SignJWT } = await import('jose');
    const { SESSION_ISSUER, sessionSecret } = await import('@saep/sdk');
    const past = Math.floor(Date.now() / 1000) - 7200;
    const token = await new SignJWT({ address: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(SESSION_ISSUER)
      .setSubject('x')
      .setIssuedAt(past - 3600)
      .setExpirationTime(past)
      .sign(sessionSecret(TEST_SECRET));
    cookieStore.set('saep_session', token);

    const { GET } = await import('../app/api/auth/me/route.js');
    const res = await GET();
    const data = await res.json();
    expect(data.session).toBeNull();
  });
});

describe('POST /api/auth/logout', () => {
  it('returns ok and clears session', async () => {
    cookieStore.set('saep_session', 'some-token');
    const { POST } = await import('../app/api/auth/logout/route.js');
    const res = await POST();
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(cookieStore.has('saep_session')).toBe(false);
  });
});

describe('POST /api/auth/ws-token', () => {
  it('returns 401 without session', async () => {
    const { POST } = await import('../app/api/auth/ws-token/route.js');
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it('returns token for authenticated user', async () => {
    const { SignJWT } = await import('jose');
    const { SESSION_ISSUER, sessionSecret } = await import('@saep/sdk');
    const address = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ address })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(SESSION_ISSUER)
      .setSubject(address)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(sessionSecret(TEST_SECRET));
    cookieStore.set('saep_session', token);

    const { POST } = await import('../app/api/auth/ws-token/route.js');
    const res = await POST();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token).toBeTruthy();
    expect(data.address).toBe(address);
    expect(data.expiresAt).toBeTruthy();
  });
});
