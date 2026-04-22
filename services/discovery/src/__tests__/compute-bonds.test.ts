import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer, type DiscoveryDb } from '../server.js';
import type { ComputeBondSummary } from '../compute-bonds.js';

function makeBond(overrides: Partial<ComputeBondSummary> = {}): ComputeBondSummary {
  return {
    lease_id: 'ionet-lease-1',
    agent_did: 'agent-did-1',
    provider: 'ionet',
    gpu_hours: 8,
    expires_at: 1_710_000_000,
    slashable_until: 1_710_003_600,
    task_id: 'aa'.repeat(32),
    status: 'locked',
    status_reason: null,
    reserved_price_usd_micro: 50_000_000,
    broker_pubkey: 'broker-pubkey',
    attestation_sig: 'attestation-sig',
    created_at_ms: 1_710_000_000_000,
    updated_at_ms: 1_710_000_100_000,
    provider_status: 'active',
    ...overrides,
  };
}

function createDb(overrides: {
  query?: (text: string, values?: unknown[]) => Promise<unknown[]>;
  queryOne?: (text: string, values?: unknown[]) => Promise<unknown | null>;
}) {
  const db: DiscoveryDb = {
    getPool: () =>
      ({
        query: async () => ({ rows: [{ ok: 1 }] }),
      }) as never,
    query: async <T>(text: string, values?: unknown[]) =>
      ((await overrides.query?.(text, values)) ?? []) as T[],
    queryOne: async <T>(text: string, values?: unknown[]) =>
      (((await overrides.queryOne?.(text, values)) ?? null) as T | null),
    close: async () => {},
  };
  return db;
}

describe('discovery compute bond visibility', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enriches /tasks with persisted compute bonds from the snapshot table', async () => {
    const taskId = 'aa'.repeat(32);
    const agentDid = 'bb'.repeat(32);
    const db = createDb({
      async query(text: string) {
        if (text.includes('FROM task_directory t')) {
          return [
            {
              task_id: Buffer.from(taskId, 'hex'),
              creator: 'creator-1',
              agent_did: Buffer.from(agentDid, 'hex'),
              status: 'open',
              reward_lamports: '1000',
              capability_mask: '7',
              created_at_unix: '100',
              deadline_unix: '200',
              updated_at_unix: '150',
            },
          ];
        }
        if (text.includes('FROM compute_bond_snapshots')) {
          return [{ ...makeBond({ task_id: taskId }), task_id_hex: taskId }];
        }
        return [];
      },
      async queryOne(text: string) {
        if (text.includes('SELECT count(*)::int AS total')) {
          return { total: 1 };
        }
        return null;
      },
    });
    const app = await buildServer({
      installSignalHandlers: false,
      db,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/tasks',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      items: [
        {
          task_id_hex: taskId,
          compute_bonds: [
            {
              lease_id: 'ionet-lease-1',
              task_id: taskId,
              status: 'locked',
            },
          ],
        },
      ],
      total: 1,
    });

    await app.close();
  });

  it('exposes task-linked persisted compute bonds through agent and task routes', async () => {
    const taskId = 'cc'.repeat(32);
    const agentDid = 'dd'.repeat(32);
    const bond = makeBond({ lease_id: 'akash-lease-2', provider: 'akash', task_id: taskId });
    const db = createDb({
      async query(text: string) {
        if (text.includes('SELECT task_id, creator, status')) {
          return [
            {
              task_id: Buffer.from(taskId, 'hex'),
              creator: 'creator-2',
              status: 'assigned',
              reward_lamports: '2000',
              created_at_unix: '110',
              deadline_unix: '210',
              updated_at_unix: '160',
            },
          ];
        }
        if (text.includes('SELECT task_id') && text.includes('WHERE agent_did = $1')) {
          return [{ task_id: Buffer.from(taskId, 'hex') }];
        }
        if (text.includes('FROM compute_bond_snapshots')) {
          return [{ ...bond, task_id_hex: taskId }];
        }
        return [];
      },
      async queryOne(text: string) {
        if (text.includes('SELECT count(*)::int AS total')) {
          return { total: 1 };
        }
        return null;
      },
    });
    const app = await buildServer({
      installSignalHandlers: false,
      db,
    });

    const agentTasks = await app.inject({
      method: 'GET',
      url: `/agents/${agentDid}/tasks`,
    });
    expect(agentTasks.statusCode).toBe(200);
    expect(agentTasks.json()).toMatchObject({
      items: [
        {
          task_id: taskId,
          compute_bonds: [
            {
              lease_id: 'akash-lease-2',
              provider: 'akash',
            },
          ],
        },
      ],
    });

    const agentBonds = await app.inject({
      method: 'GET',
      url: `/agents/${agentDid}/compute-bonds?status=locked&provider=akash`,
    });
    expect(agentBonds.statusCode).toBe(200);
    expect(agentBonds.json()).toMatchObject({
      agent_did: agentDid,
      items: [
        {
          lease_id: 'akash-lease-2',
          task_id: taskId,
          provider: 'akash',
        },
      ],
    });

    const taskBonds = await app.inject({
      method: 'GET',
      url: `/tasks/${taskId}/compute-bonds?status=locked`,
    });
    expect(taskBonds.statusCode).toBe(200);
    expect(taskBonds.json()).toMatchObject({
      task_id: taskId,
      items: [
        {
          lease_id: 'akash-lease-2',
          task_id: taskId,
        },
      ],
    });

    await app.close();
  });

  it('returns empty compute bond arrays when no persisted snapshots exist', async () => {
    const taskId = 'ee'.repeat(32);
    const agentDid = 'ff'.repeat(32);
    const db = createDb({
      async query(text: string) {
        if (text.includes('FROM task_directory t')) {
          return [
            {
              task_id: Buffer.from(taskId, 'hex'),
              creator: 'creator-3',
              agent_did: null,
              status: 'open',
              reward_lamports: '3000',
              capability_mask: '1',
              created_at_unix: '120',
              deadline_unix: '220',
              updated_at_unix: '170',
            },
          ];
        }
        if (text.includes('SELECT task_id') && text.includes('WHERE agent_did = $1')) {
          return [{ task_id: Buffer.from(taskId, 'hex') }];
        }
        return [];
      },
      async queryOne(text: string) {
        if (text.includes('SELECT count(*)::int AS total')) {
          return { total: 1 };
        }
        return null;
      },
    });
    const app = await buildServer({
      installSignalHandlers: false,
      db,
    });

    const tasks = await app.inject({
      method: 'GET',
      url: '/tasks',
    });
    expect(tasks.statusCode).toBe(200);
    expect(tasks.json()).toMatchObject({
      items: [
        {
          task_id_hex: taskId,
          compute_bonds: [],
        },
      ],
    });

    const taskBonds = await app.inject({
      method: 'GET',
      url: `/tasks/${taskId}/compute-bonds`,
    });
    expect(taskBonds.statusCode).toBe(200);
    expect(taskBonds.json()).toMatchObject({
      task_id: taskId,
      items: [],
    });

    const agentBonds = await app.inject({
      method: 'GET',
      url: `/agents/${agentDid}/compute-bonds`,
    });
    expect(agentBonds.statusCode).toBe(200);
    expect(agentBonds.json()).toMatchObject({
      agent_did: agentDid,
      items: [],
    });

    await app.close();
  });
});
