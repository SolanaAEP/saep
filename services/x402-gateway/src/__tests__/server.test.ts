import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import { getPublicKeyAsync, signAsync, hashes } from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import bs58 from 'bs58';
import { build } from '../server.js';
import { loadConfig } from '../config.js';
import { canonicalizeProxy } from '../auth.js';

hashes.sha512 = sha512;

describe('x402-gateway server', () => {
  const redis = new RedisMock() as unknown as Redis;
  let app: FastifyInstance;
  const cfg = loadConfig({ ALLOW_PATTERN: '*.saep.example', MAX_BUDGET_LAMPORTS: '100000' });

  beforeAll(async () => {
    app = build({ cfg, redis });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('healthz returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('metrics exposes prometheus text', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('x402_proxy_requests_total');
  });

  it('proxy rejects bad body', async () => {
    const res = await app.inject({ method: 'POST', url: '/proxy', payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('proxy rejects off-allowlist target', async () => {
    const sk = new Uint8Array(32).fill(9);
    const pk = await getPublicKeyAsync(sk);
    const body = {
      target_url: 'https://evil.example/pay',
      method: 'POST',
      budget_lamports: 1_000,
      mint: '11111111111111111111111111111111',
      nonce: 'n1',
      agent_did: bs58.encode(pk),
      signature: bs58.encode(await signAsync(new TextEncoder().encode('x'), sk)),
    };
    const res = await app.inject({ method: 'POST', url: '/proxy', payload: body });
    expect(res.statusCode).toBe(403);
  });

  it('proxy rejects over-budget', async () => {
    const sk = new Uint8Array(32).fill(9);
    const pk = await getPublicKeyAsync(sk);
    const body = {
      target_url: 'https://api.saep.example/x',
      method: 'POST',
      budget_lamports: 10_000_000,
      mint: '11111111111111111111111111111111',
      nonce: 'n2',
      agent_did: bs58.encode(pk),
      signature: bs58.encode(await signAsync(new TextEncoder().encode('x'), sk)),
    };
    const res = await app.inject({ method: 'POST', url: '/proxy', payload: body });
    expect(res.statusCode).toBe(400);
  });

  it('proxy rejects bad signature', async () => {
    const pk = await getPublicKeyAsync(new Uint8Array(32).fill(1));
    const body = {
      target_url: 'https://api.saep.example/x',
      method: 'POST',
      budget_lamports: 1_000,
      mint: '11111111111111111111111111111111',
      nonce: 'n3',
      agent_did: bs58.encode(pk),
      signature: bs58.encode(new Uint8Array(64)),
    };
    const res = await app.inject({ method: 'POST', url: '/proxy', payload: body });
    expect(res.statusCode).toBe(401);
  });

  it('proxy with valid sig returns NOT_YET_WIRED 501', async () => {
    const sk = new Uint8Array(32).fill(3);
    const pk = await getPublicKeyAsync(sk);
    const fields = {
      target_url: 'https://api.saep.example/x',
      method: 'POST' as const,
      budget_lamports: 1_000,
      mint: '11111111111111111111111111111111',
      nonce: 'n4',
    };
    const canonical = canonicalizeProxy(fields);
    const sig = await signAsync(new TextEncoder().encode(canonical), sk);
    const body = {
      ...fields,
      agent_did: bs58.encode(pk),
      signature: bs58.encode(sig),
    };
    const res = await app.inject({ method: 'POST', url: '/proxy', payload: body });
    expect(res.statusCode).toBe(501);
    expect(res.json().error).toBe('NOT_YET_WIRED');
  });

  it('facilitate/verify returns 501 NOT_YET_WIRED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/facilitate/verify',
      payload: { x_payment: 'opaque', resource_ref: 'task:abc' },
    });
    expect(res.statusCode).toBe(501);
  });
});
