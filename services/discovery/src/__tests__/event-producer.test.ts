import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WebhookEventProducer,
  mapEventRow,
  type ProgramEventRow,
  type ProducerDb,
} from '../event-producer.js';
import { WebhookHub } from '../webhooks.js';

const log = pino({ level: 'silent' });

const TASK_ID_BYTES = Array.from({ length: 32 }, (_, i) => i + 1);
const TASK_ID_HEX = TASK_ID_BYTES.map((b) => b.toString(16).padStart(2, '0')).join('');
const AGENT_DID_BYTES = Array.from({ length: 32 }, (_, i) => i + 100);
const AGENT_DID_HEX = AGENT_DID_BYTES.map((b) => b.toString(16).padStart(2, '0')).join('');

function row(overrides: Partial<ProgramEventRow> & Pick<ProgramEventRow, 'event_name' | 'data'>): ProgramEventRow {
  return {
    id: '1',
    signature: 'sig123',
    slot: '900',
    program_id: 'prog',
    ...overrides,
  };
}

describe('mapEventRow', () => {
  it('maps TaskCreated → task.created with hex task id and forwarded payload', () => {
    const out = mapEventRow(
      row({
        id: '7',
        event_name: 'TaskCreated',
        data: {
          task_id: TASK_ID_BYTES,
          client: 'ClientPubkey',
          agent_did: AGENT_DID_BYTES,
          payment_amount: '1000000',
          deadline: '1700001000',
          timestamp: '1700000000',
        },
      }),
      'mainnet-beta',
    );
    expect(out).toEqual({
      id: 'program_event:7',
      type: 'task.created',
      chain: 'solana',
      cluster: 'mainnet-beta',
      resource: { type: 'task', id: TASK_ID_HEX },
      payload: {
        task_id: TASK_ID_HEX,
        client: 'ClientPubkey',
        agent_did: AGENT_DID_HEX,
        payment_amount: '1000000',
        deadline: '1700001000',
        timestamp: '1700000000',
        signature: 'sig123',
        slot: '900',
      },
    });
  });

  it('maps TaskVerified → task.verified', () => {
    const out = mapEventRow(
      row({
        event_name: 'TaskVerified',
        data: { task_id: TASK_ID_BYTES, dispute_window_end: '1700100000', timestamp: '1700099000' },
      }),
      'devnet',
    );
    expect(out?.type).toBe('task.verified');
    expect(out?.resource.id).toBe(TASK_ID_HEX);
    expect(out?.payload.dispute_window_end).toBe('1700100000');
  });

  it('maps TaskReleased → task.released with payout fields', () => {
    const out = mapEventRow(
      row({
        event_name: 'TaskReleased',
        data: {
          task_id: TASK_ID_BYTES,
          agent_did: AGENT_DID_BYTES,
          operator: 'Op',
          client: 'Client',
          mint: 'Mint',
          agent_payout: '900000',
          protocol_fee: '50000',
          solrep_fee: '50000',
          timestamp: '1700200000',
        },
      }),
      'devnet',
    );
    expect(out?.type).toBe('task.released');
    expect(out?.payload).toMatchObject({
      agent_payout: '900000',
      protocol_fee: '50000',
      solrep_fee: '50000',
    });
  });

  it('maps DisputeRaised → task.disputed', () => {
    const out = mapEventRow(
      row({ event_name: 'DisputeRaised', data: { task_id: TASK_ID_BYTES, client: 'C', timestamp: '1' } }),
      'devnet',
    );
    expect(out?.type).toBe('task.disputed');
  });

  it('maps BidRevealed → bid.revealed with composite resource id', () => {
    const out = mapEventRow(
      row({
        event_name: 'BidRevealed',
        data: { task_id: TASK_ID_BYTES, bidder: 'BidderPubkey', amount: '500' },
      }),
      'devnet',
    );
    expect(out?.type).toBe('bid.revealed');
    expect(out?.resource).toEqual({ type: 'bid', id: `${TASK_ID_HEX}:BidderPubkey` });
    expect(out?.payload.amount).toBe('500');
  });

  it('maps StreamWithdrawn → stream.withdrawn keyed by agent did', () => {
    const out = mapEventRow(
      row({
        event_name: 'StreamWithdrawn',
        data: { agent_did: AGENT_DID_BYTES, claimable: '700', swapped: true, timestamp: '1' },
      }),
      'devnet',
    );
    expect(out?.type).toBe('stream.withdrawn');
    expect(out?.resource).toEqual({ type: 'stream', id: AGENT_DID_HEX });
    expect(out?.payload.swapped).toBe(true);
  });

  it('maps AgentRegistered and ManifestUpdated → agent.status_changed with distinct change tag', () => {
    const a = mapEventRow(
      row({
        event_name: 'AgentRegistered',
        data: { agent_did: AGENT_DID_BYTES, operator: 'Op', capability_mask: '1', stake_amount: '100', timestamp: '1' },
      }),
      'devnet',
    );
    const b = mapEventRow(
      row({
        event_name: 'ManifestUpdated',
        data: { agent_did: AGENT_DID_BYTES, version: '2', capability_mask: '3', timestamp: '1' },
      }),
      'devnet',
    );
    expect(a?.type).toBe('agent.status_changed');
    expect(b?.type).toBe('agent.status_changed');
    expect(a?.payload.change).toBe('registered');
    expect(b?.payload.change).toBe('manifest_updated');
  });

  it('returns null for unmapped event names', () => {
    expect(mapEventRow(row({ event_name: 'TaskFunded', data: { task_id: TASK_ID_BYTES } }), 'devnet')).toBeNull();
    expect(mapEventRow(row({ event_name: 'StakeUpdated', data: {} }), 'devnet')).toBeNull();
  });

  it('returns null when required identifier bytes are missing or malformed', () => {
    expect(mapEventRow(row({ event_name: 'TaskCreated', data: {} }), 'devnet')).toBeNull();
    expect(mapEventRow(row({ event_name: 'TaskCreated', data: { task_id: 'not-an-array' } }), 'devnet')).toBeNull();
    expect(mapEventRow(row({ event_name: 'TaskCreated', data: { task_id: [1, 2, 999] } }), 'devnet')).toBeNull();
    expect(mapEventRow(row({ event_name: 'BidRevealed', data: { task_id: TASK_ID_BYTES } }), 'devnet')).toBeNull();
    expect(mapEventRow(row({ event_name: 'StreamWithdrawn', data: {} }), 'devnet')).toBeNull();
  });

  it('uses the row id for deterministic event id so re-emit dedups', () => {
    const a = mapEventRow(
      row({ id: '42', event_name: 'TaskCreated', data: { task_id: TASK_ID_BYTES, timestamp: '1' } }),
      'devnet',
    );
    const b = mapEventRow(
      row({ id: '42', event_name: 'TaskCreated', data: { task_id: TASK_ID_BYTES, timestamp: '1' } }),
      'devnet',
    );
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.id).toBe('program_event:42');
    expect(a!.id).toBe(b!.id);
  });
});

interface FakeDbState {
  cursor: string;
  events: ProgramEventRow[];
  updates: number;
}

function makeFakeDb(state: FakeDbState): ProducerDb {
  return {
    async query<T extends Record<string, unknown>>(text: string, values?: unknown[]): Promise<T[]> {
      const trimmed = text.trim().toUpperCase();
      if (trimmed.startsWith('CREATE TABLE')) return [] as T[];
      if (trimmed.startsWith('SELECT LAST_EVENT_ID')) {
        return [{ last_event_id: state.cursor }] as unknown as T[];
      }
      if (trimmed.startsWith('SELECT ID,')) {
        const cursor = (values?.[0] as string) ?? '0';
        const limit = (values?.[2] as number) ?? 100;
        const visible = state.events
          .filter((row) => BigInt(row.id) > BigInt(cursor))
          .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
          .slice(0, limit);
        return visible as unknown as T[];
      }
      if (trimmed.startsWith('UPDATE WEBHOOK_EVENT_CURSOR')) {
        state.cursor = String(values?.[0] ?? state.cursor);
        state.updates += 1;
        return [] as T[];
      }
      throw new Error(`unexpected query in fake db: ${text}`);
    },
  };
}

describe('WebhookEventProducer.runOnce', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits one webhook per mapped event and advances the cursor', async () => {
    const hub = new WebhookHub({ retryBaseMs: 1, maxAttempts: 1 });
    const emit = vi.spyOn(hub, 'emit');
    const state: FakeDbState = {
      cursor: '0',
      events: [
        row({ id: '1', event_name: 'TaskCreated', data: { task_id: TASK_ID_BYTES, timestamp: '1' } }),
        row({ id: '2', event_name: 'TaskFunded', data: { task_id: TASK_ID_BYTES } }), // unmapped, skipped
        row({ id: '3', event_name: 'BidRevealed', data: { task_id: TASK_ID_BYTES, bidder: 'B', amount: '1' } }),
      ],
      updates: 0,
    };
    const producer = new WebhookEventProducer({ db: makeFakeDb(state), hub, log, cluster: 'devnet' });

    const result = await producer.runOnce();

    expect(result.emitted).toBe(2);
    expect(result.cursor).toBe('3');
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0]![0].type).toBe('task.created');
    expect(emit.mock.calls[1]![0].type).toBe('bid.revealed');
    expect(state.cursor).toBe('3');
    expect(state.updates).toBe(1);
  });

  it('reports zero work and does not update cursor when nothing is new', async () => {
    const hub = new WebhookHub({ retryBaseMs: 1, maxAttempts: 1 });
    const emit = vi.spyOn(hub, 'emit');
    const state: FakeDbState = { cursor: '50', events: [], updates: 0 };
    const producer = new WebhookEventProducer({ db: makeFakeDb(state), hub, log, cluster: 'devnet' });

    const result = await producer.runOnce();

    expect(result.emitted).toBe(0);
    expect(emit).not.toHaveBeenCalled();
    expect(state.updates).toBe(0);
  });

  it('still advances the cursor over batches that are entirely unmapped events', async () => {
    const hub = new WebhookHub({ retryBaseMs: 1, maxAttempts: 1 });
    const emit = vi.spyOn(hub, 'emit');
    const state: FakeDbState = {
      cursor: '0',
      events: [
        row({ id: '10', event_name: 'TaskCreated', data: { task_id: TASK_ID_BYTES, timestamp: '1' } }),
      ],
      updates: 0,
    };
    const producer = new WebhookEventProducer({ db: makeFakeDb(state), hub, log, cluster: 'devnet' });

    await producer.runOnce();
    expect(state.cursor).toBe('10');
    expect(emit).toHaveBeenCalledTimes(1);

    await producer.runOnce();
    expect(state.cursor).toBe('10');
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('re-emit of the same row is a duplicate (deterministic event id) — emit() returns duplicate=true', async () => {
    const hub = new WebhookHub({ retryBaseMs: 1, maxAttempts: 1 });
    const first = await hub.emit({
      id: 'program_event:99',
      type: 'task.created',
      chain: 'solana',
      cluster: 'devnet',
      resource: { type: 'task', id: TASK_ID_HEX },
      payload: {},
    });
    expect(first.duplicate).toBe(false);
    const second = await hub.emit({
      id: 'program_event:99',
      type: 'task.created',
      chain: 'solana',
      cluster: 'devnet',
      resource: { type: 'task', id: TASK_ID_HEX },
      payload: {},
    });
    expect(second.duplicate).toBe(true);
    expect(second.event.id).toBe('program_event:99');
  });
});
