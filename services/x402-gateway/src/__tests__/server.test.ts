import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
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

function startMockUpstream(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

async function makeValidProxy(
  targetUrl: string,
  budget = 1_000,
  nonce = 'n1',
) {
  const sk = new Uint8Array(32).fill(3);
  const pk = await getPublicKeyAsync(sk);
  const fields = {
    target_url: targetUrl,
    method: 'POST' as const,
    budget_lamports: budget,
    mint: '11111111111111111111111111111111',
    nonce,
  };
  const canonical = canonicalizeProxy(fields);
  const sig = await signAsync(new TextEncoder().encode(canonical), sk);
  return { ...fields, agent_did: bs58.encode(pk), signature: bs58.encode(sig) };
}

describe('x402-gateway server', () => {
  const redis = new RedisMock() as unknown as Redis;
  let app: FastifyInstance;
  let mockServer: Server | undefined;

  const cfg = loadConfig({
    ALLOW_PATTERN: '*.saep.example',
    ALLOW_LIST: '127.0.0.1',
    MAX_BUDGET_LAMPORTS: '100000',
    PROXY_TIMEOUT_MS: '5000',
    MAX_402_RETRIES: '1',
  });

  beforeAll(async () => {
    app = build({ cfg, redis });
    await app.ready();
  });

  afterEach(() => {
    if (mockServer) {
      mockServer.close();
      mockServer = undefined;
    }
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

  it('proxy forwards to upstream and returns response', async () => {
    const { server, port } = await startMockUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ result: 'hello' }));
    });
    mockServer = server;

    const body = await makeValidProxy(`http://127.0.0.1:${port}/api`);
    const res = await app.inject({ method: 'POST', url: '/proxy', payload: body });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.status).toBe(200);
    expect(JSON.parse(json.body)).toEqual({ result: 'hello' });
    expect(json.payment_receipts).toEqual([]);
  });

  it('proxy handles 402 with X-PAYMENT and retries', async () => {
    let callCount = 0;
    const { server, port } = await startMockUpstream((_req, res) => {
      callCount++;
      if (callCount === 1) {
        res.writeHead(402, {
          'content-type': 'text/plain',
          'x-payment': JSON.stringify({
            scheme: 'exact',
            amount: 100,
            mint: '11111111111111111111111111111111',
            recipient: 'somepubkey1234567890123456789012',
            resource: '/api',
          }),
        });
        res.end('payment required');
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ paid: true }));
      }
    });
    mockServer = server;

    const body = await makeValidProxy(`http://127.0.0.1:${port}/api`, 1_000, 'n-402');
    const res = await app.inject({ method: 'POST', url: '/proxy', payload: body });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.payment_receipts.length).toBe(1);
    expect(json.payment_receipts[0].amount).toBe(100);
    expect(callCount).toBe(2);
  });

  it('proxy returns 402 when upstream stays 402 after retries', async () => {
    const { server, port } = await startMockUpstream((_req, res) => {
      res.writeHead(402, {
        'x-payment': JSON.stringify({
          scheme: 'exact',
          amount: 100,
          mint: '11111111111111111111111111111111',
          recipient: 'somepubkey1234567890123456789012',
          resource: '/api',
        }),
      });
      res.end('pay up');
    });
    mockServer = server;

    const body = await makeValidProxy(`http://127.0.0.1:${port}/api`, 1_000, 'n-402-stuck');
    const res = await app.inject({ method: 'POST', url: '/proxy', payload: body });
    expect(res.statusCode).toBe(402);
  });

  it('proxy returns 502 on unreachable upstream', async () => {
    const body = await makeValidProxy('https://api.saep.example/x', 1_000, 'n-502');
    const res = await app.inject({ method: 'POST', url: '/proxy', payload: body });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('upstream_error');
  });

  it('facilitate/verify rejects non-JSON x_payment', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/facilitate/verify',
      payload: { x_payment: 'not-json', resource_ref: 'task:abc' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('not valid JSON');
  });

  it('facilitate/verify rejects x_payment without tx_sig', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/facilitate/verify',
      payload: { x_payment: '{"amount":100}', resource_ref: 'task:abc' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('missing tx_sig');
  });

  it('facilitate/verify confirms devnet pseudo-sig', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/facilitate/verify',
      payload: {
        x_payment: JSON.stringify({ tx_sig: 'devnet_pending_abc12345' }),
        resource_ref: 'task:abc',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, settled_tx_sig: 'devnet_pending_abc12345' });
  });

  it('facilitate/verify returns 404 for unknown tx', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/facilitate/verify',
      payload: {
        x_payment: JSON.stringify({ tx_sig: 'nonexistent_sig_abc' }),
        resource_ref: 'task:abc',
      },
    });
    // rpc is unreachable in test, so we get not_found
    expect(res.statusCode).toBe(404);
    expect(res.json().ok).toBe(false);
  });
});
