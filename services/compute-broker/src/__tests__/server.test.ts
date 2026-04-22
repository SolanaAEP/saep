import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getPublicKeyAsync, signAsync } from '@noble/ed25519';
import bs58 from 'bs58';
import { build } from '../server.js';
import { loadConfig } from '../config.js';
import { hexToKey, verify } from '../attestation.js';
import type { ComputeProvider, LeaseRequest, LeaseReservation } from '../providers.js';

class FakeProvider implements ComputeProvider {
  readonly name: 'ionet' | 'akash';
  readonly calls: Array<{ op: string; leaseId: string }> = [];
  private statuses = new Map<string, 'reserved' | 'active' | 'cancelled' | 'reclaimed'>();
  constructor(name: 'ionet' | 'akash') {
    this.name = name;
  }
  async reserve(req: LeaseRequest): Promise<LeaseReservation> {
    const leaseId = `${this.name}-lease-${req.gpuHours}`;
    this.statuses.set(leaseId, 'reserved');
    const nowUnix = Math.floor(Date.now() / 1000);
    return {
      leaseId,
      gpuHours: req.gpuHours,
      expiresAt: nowUnix + req.durationSecs,
      pricedUsdMicro: 50_000_000,
    };
  }
  async activate(leaseId: string): Promise<void> {
    this.calls.push({ op: 'activate', leaseId });
    this.statuses.set(leaseId, 'active');
  }
  async cancel(leaseId: string): Promise<{ refundUsdMicro: number }> {
    this.calls.push({ op: 'cancel', leaseId });
    this.statuses.set(leaseId, 'cancelled');
    return { refundUsdMicro: 0 };
  }
  async reclaim(leaseId: string): Promise<void> {
    this.calls.push({ op: 'reclaim', leaseId });
    this.statuses.set(leaseId, 'reclaimed');
  }
  async status(leaseId: string): Promise<'reserved' | 'active' | 'cancelled' | 'reclaimed'> {
    return this.statuses.get(leaseId) ?? 'reserved';
  }
}

describe('compute-broker server', () => {
  const key = 'ab'.repeat(32);
  const cfg = loadConfig({ BROKER_SIGNING_KEY_HEX: key });
  let app: FastifyInstance;
  let ionet: FakeProvider;
  let akash: FakeProvider;
  let nextGpuHours = 20;

  beforeAll(async () => {
    ionet = new FakeProvider('ionet');
    akash = new FakeProvider('akash');
    app = build({
      cfg,
      providers: { ionet, akash },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function requestBond(
    payload: Partial<{
      agent_did: string;
      provider: 'ionet' | 'akash';
      gpu_hours: number;
      duration_secs: number;
    }> = {},
  ) {
    const agent_did = payload.agent_did ?? '11111111111111111111111111111111';
    const provider = payload.provider ?? 'ionet';
    const gpu_hours = payload.gpu_hours ?? nextGpuHours++;
    const duration_secs = payload.duration_secs ?? 7 * 24 * 3600;
    const res = await app.inject({
      method: 'POST',
      url: '/bonds/request',
      payload: {
        agent_did,
        provider,
        gpu_hours,
        duration_secs,
      },
    });
    expect(res.statusCode).toBe(200);
    return {
      agent_did,
      provider,
      body: res.json() as {
        lease_id: string;
        attestation_sig: string;
        broker_pubkey: string;
        gpu_hours: number;
        expires_at: number;
        slashable_until: number;
      },
    };
  }

  it('healthz reports key loaded', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ broker_key_loaded: true });
  });

  it('metrics exposes prometheus text', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('compute_broker_bond_requests_total');
    expect(res.body).toContain('compute_broker_lease_lifecycle_ops_total');
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
    const { body } = await requestBond();
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

  it('bonds/verify validates the attestation payload over HTTP', async () => {
    const { agent_did, provider, body } = await requestBond({ gpu_hours: 6 });
    const res = await app.inject({
      method: 'POST',
      url: '/bonds/verify',
      payload: {
        agent_did,
        provider,
        lease_id: body.lease_id,
        gpu_hours: body.gpu_hours,
        expires_at: body.expires_at,
        attestation_sig: body.attestation_sig,
        broker_pubkey: body.broker_pubkey,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ valid: true });
  });

  it('bonds/:id exposes tracked bond state', async () => {
    const { body } = await requestBond({ gpu_hours: 3 });
    const res = await app.inject({
      method: 'GET',
      url: `/bonds/${body.lease_id}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      lease_id: body.lease_id,
      status: 'reserved',
      provider_status: 'reserved',
    });
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

  it('bonds/cancel rejects invalid signature', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/bonds/cancel',
      payload: {
        lease_id: 'lease-1',
        agent_did: '11111111111111111111111111111111',
        signed_request: 'badsig',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('bonds/cancel succeeds with valid agent signature', async () => {
    const agentKey = hexToKey('cd'.repeat(32));
    const agentPk = await getPublicKeyAsync(agentKey);
    const agentDid = bs58.encode(agentPk);
    const { body } = await requestBond({ agent_did: agentDid });
    const leaseId = body.lease_id;
    const cancelMsg = new TextEncoder().encode(
      JSON.stringify({ action: 'cancel', lease_id: leaseId, agent_did: agentDid }),
    );
    const sig = await signAsync(cancelMsg, agentKey);
    const res = await app.inject({
      method: 'POST',
      url: '/bonds/cancel',
      payload: {
        lease_id: leaseId,
        agent_did: agentDid,
        signed_request: bs58.encode(sig),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ lease_id: leaseId, status: 'cancelled' });

    const tracked = await app.inject({ method: 'GET', url: `/bonds/${leaseId}` });
    expect(tracked.json()).toMatchObject({ status: 'cancelled' });
  });

  it('bonds/lock binds a reservation to one task and rejects rebinding', async () => {
    const { agent_did, provider, body } = await requestBond({ gpu_hours: 9 });
    const res = await app.inject({
      method: 'POST',
      url: '/bonds/lock',
      payload: {
        lease_id: body.lease_id,
        provider,
        agent_did,
        task_id: 'task-alpha',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      lease_id: body.lease_id,
      task_id: 'task-alpha',
      status: 'locked',
      provider_status: 'active',
    });
    expect(ionet.calls).toContainEqual({ op: 'activate', leaseId: body.lease_id });

    const second = await app.inject({
      method: 'POST',
      url: '/bonds/lock',
      payload: {
        lease_id: body.lease_id,
        provider,
        agent_did,
        task_id: 'task-beta',
      },
    });
    expect(second.statusCode).toBe(409);
  });

  it('bonds/release reclaims the provider lease after task completion', async () => {
    const { agent_did, provider, body } = await requestBond({ gpu_hours: 10 });
    await app.inject({
      method: 'POST',
      url: '/bonds/lock',
      payload: {
        lease_id: body.lease_id,
        provider,
        agent_did,
        task_id: 'task-release',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/bonds/release',
      payload: {
        lease_id: body.lease_id,
        provider,
        agent_did,
        task_id: 'task-release',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      lease_id: body.lease_id,
      status: 'released',
      provider_status: 'reclaimed',
    });
    expect(ionet.calls).toContainEqual({ op: 'reclaim', leaseId: body.lease_id });
  });

  it('bonds/slash marks the bond terminal and records the reason', async () => {
    const { agent_did, provider, body } = await requestBond({
      provider: 'akash',
      gpu_hours: 11,
    });
    await app.inject({
      method: 'POST',
      url: '/bonds/lock',
      payload: {
        lease_id: body.lease_id,
        provider,
        agent_did,
        task_id: 'task-slash',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/bonds/slash',
      payload: {
        lease_id: body.lease_id,
        provider,
        agent_did,
        task_id: 'task-slash',
        reason: 'missed deadline',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      lease_id: body.lease_id,
      status: 'slashed',
      status_reason: 'missed deadline',
      provider_status: 'reclaimed',
    });
    expect(akash.calls).toContainEqual({ op: 'reclaim', leaseId: body.lease_id });
  });

  it('leases/activate activates the selected provider lease', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/leases/activate',
      payload: {
        lease_id: 'ionet-lease-9',
        provider: 'ionet',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ lease_id: 'ionet-lease-9', status: 'active' });
    expect(ionet.calls).toContainEqual({ op: 'activate', leaseId: 'ionet-lease-9' });
  });

  it('leases/reclaim reclaims the selected provider lease', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/leases/reclaim',
      payload: {
        lease_id: 'akash-lease-5',
        provider: 'akash',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ lease_id: 'akash-lease-5', status: 'reclaimed' });
    expect(akash.calls).toContainEqual({ op: 'reclaim', leaseId: 'akash-lease-5' });
  });

  it('leases/expire-sweep reclaims expired leases and skips active windows', async () => {
    const tracked = await requestBond({ provider: 'ionet', gpu_hours: 12 });
    const res = await app.inject({
      method: 'POST',
      url: '/leases/expire-sweep',
      payload: {
        now_unix: tracked.body.slashable_until + 1,
        leases: [
          {
            lease_id: tracked.body.lease_id,
            provider: 'ionet',
            slashable_until: tracked.body.slashable_until,
          },
          {
            lease_id: 'akash-still-live',
            provider: 'akash',
            slashable_until: tracked.body.slashable_until + 500,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      reclaimed: 1,
      skipped: 1,
      errors: 0,
    });
    expect(ionet.calls).toContainEqual({ op: 'reclaim', leaseId: tracked.body.lease_id });
    const expired = await app.inject({ method: 'GET', url: `/bonds/${tracked.body.lease_id}` });
    expect(expired.json()).toMatchObject({ status: 'expired' });
  });
});
