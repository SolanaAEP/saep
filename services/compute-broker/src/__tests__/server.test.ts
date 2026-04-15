import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { build } from '../server.js';
import { loadConfig } from '../config.js';
import { verify } from '../attestation.js';
import type { ComputeProvider, LeaseRequest, LeaseReservation } from '../providers.js';

class FakeProvider implements ComputeProvider {
  readonly name: 'ionet' | 'akash';
  constructor(name: 'ionet' | 'akash') {
    this.name = name;
  }
  async reserve(req: LeaseRequest): Promise<LeaseReservation> {
    return {
      leaseId: `${this.name}-lease-${req.gpuHours}`,
      gpuHours: req.gpuHours,
      expiresAt: 1_700_000_000,
      pricedUsdMicro: 50_000_000,
    };
  }
  async activate(): Promise<void> {}
  async cancel(): Promise<{ refundUsdMicro: number }> {
    return { refundUsdMicro: 0 };
  }
  async reclaim(): Promise<void> {}
  async status(): Promise<'reserved'> {
    return 'reserved';
  }
}

describe('compute-broker server', () => {
  const key = 'ab'.repeat(32);
  const cfg = loadConfig({ BROKER_SIGNING_KEY_HEX: key });
  let app: FastifyInstance;

  beforeAll(async () => {
    app = build({
      cfg,
      providers: { ionet: new FakeProvider('ionet'), akash: new FakeProvider('akash') },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('healthz reports key loaded', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ broker_key_loaded: true });
  });

  it('metrics exposes prometheus text', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('compute_broker_bond_requests_total');
  });

  it('bonds/request rejects bad body', async () => {
    const res = await app.inject({ method: 'POST', url: '/bonds/request', payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('bonds/request rejects over-max duration', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/bonds/request',
      payload: {
        agent_did: '11111111111111111111111111111111',
        provider: 'ionet',
        gpu_hours: 4,
        duration_secs: 20 * 24 * 3600,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('bonds/request returns attestation that verifies under broker pubkey', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/bonds/request',
      payload: {
        agent_did: '11111111111111111111111111111111',
        provider: 'ionet',
        gpu_hours: 4,
        duration_secs: 7 * 24 * 3600,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      lease_id: string;
      attestation_sig: string;
      broker_pubkey: string;
      gpu_hours: number;
      expires_at: number;
    };
    const ok = await verify(
      {
        agent_did: '11111111111111111111111111111111',
        provider: 'ionet',
        lease_id: body.lease_id,
        gpu_hours: body.gpu_hours,
        expires_at: body.expires_at,
      },
      body.attestation_sig,
      body.broker_pubkey,
    );
    expect(ok).toBe(true);
  });

  it('bonds/request returns 503 without broker key', async () => {
    const nokey = build({
      cfg: loadConfig({}),
      providers: { ionet: new FakeProvider('ionet'), akash: new FakeProvider('akash') },
    });
    await nokey.ready();
    const res = await nokey.inject({
      method: 'POST',
      url: '/bonds/request',
      payload: {
        agent_did: '11111111111111111111111111111111',
        provider: 'ionet',
        gpu_hours: 4,
        duration_secs: 3600,
      },
    });
    expect(res.statusCode).toBe(503);
    await nokey.close();
  });

  it('bonds/cancel returns 501 NOT_YET_WIRED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/bonds/cancel',
      payload: {
        lease_id: 'lease-1',
        agent_did: '11111111111111111111111111111111',
        signed_request: 'sig',
      },
    });
    expect(res.statusCode).toBe(501);
  });
});
