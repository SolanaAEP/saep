import type { Logger } from 'pino';
import type { WebhookHub, WebhookEventInput } from './webhooks.js';

export interface ProducerDb {
  query<T extends Record<string, unknown>>(text: string, values?: unknown[]): Promise<T[]>;
}

// Polls indexer's `program_events` table, maps each row to a webhook event,
// and calls webhookHub.emit() in-process. The hub owns delivery, retry, DLQ —
// the producer's only job is to translate decoded on-chain events into typed
// webhook events and feed the existing fanout.
//
// Cursor: `webhook_event_cursor` table (single row, id=1). Survives restarts.
// At-least-once: cursor advances after each emit() returns. A crash mid-batch
// re-emits the in-flight rows on restart, but emit() short-circuits when the
// deterministic event id (`program_event:<row_id>`) is already in the events
// Map. Duplicates show up only across full process restarts, when the Map is
// cleared — subscribers should dedup by event id regardless.

export interface ProgramEventRow {
  id: string; // BIGSERIAL — pg returns BIGINT as string
  signature: string;
  slot: string;
  program_id: string;
  event_name: string;
  data: Record<string, unknown>;
}

const MAPPED_EVENTS = [
  'TaskCreated',
  'TaskVerified',
  'TaskReleased',
  'DisputeRaised',
  'BidRevealed',
  'StreamWithdrawn',
  'AgentRegistered',
  'ManifestUpdated',
] as const;

function bytesArrayToHex(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return null;
  let out = '';
  for (const byte of value) {
    if (typeof byte !== 'number' || byte < 0 || byte > 255 || !Number.isInteger(byte)) return null;
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

function readString(data: Record<string, unknown>, key: string): string | null {
  const v = data[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function readNumeric(data: Record<string, unknown>, key: string): string | null {
  const v = data[key];
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v.toString();
  return null;
}

export function mapEventRow(row: ProgramEventRow, cluster: string): WebhookEventInput | null {
  const id = `program_event:${row.id}`;
  const data = row.data ?? {};

  switch (row.event_name) {
    case 'TaskCreated': {
      const task = bytesArrayToHex(data.task_id);
      if (!task) return null;
      return {
        id,
        type: 'task.created',
        chain: 'solana',
        cluster,
        resource: { type: 'task', id: task },
        payload: {
          task_id: task,
          client: readString(data, 'client'),
          agent_did: bytesArrayToHex(data.agent_did),
          payment_amount: readNumeric(data, 'payment_amount'),
          deadline: readNumeric(data, 'deadline'),
          timestamp: readNumeric(data, 'timestamp'),
          signature: row.signature,
          slot: row.slot,
        },
      };
    }
    case 'TaskVerified': {
      const task = bytesArrayToHex(data.task_id);
      if (!task) return null;
      return {
        id,
        type: 'task.verified',
        chain: 'solana',
        cluster,
        resource: { type: 'task', id: task },
        payload: {
          task_id: task,
          dispute_window_end: readNumeric(data, 'dispute_window_end'),
          timestamp: readNumeric(data, 'timestamp'),
          signature: row.signature,
          slot: row.slot,
        },
      };
    }
    case 'TaskReleased': {
      const task = bytesArrayToHex(data.task_id);
      if (!task) return null;
      return {
        id,
        type: 'task.released',
        chain: 'solana',
        cluster,
        resource: { type: 'task', id: task },
        payload: {
          task_id: task,
          agent_did: bytesArrayToHex(data.agent_did),
          operator: readString(data, 'operator'),
          client: readString(data, 'client'),
          mint: readString(data, 'mint'),
          agent_payout: readNumeric(data, 'agent_payout'),
          protocol_fee: readNumeric(data, 'protocol_fee'),
          solrep_fee: readNumeric(data, 'solrep_fee'),
          timestamp: readNumeric(data, 'timestamp'),
          signature: row.signature,
          slot: row.slot,
        },
      };
    }
    case 'DisputeRaised': {
      const task = bytesArrayToHex(data.task_id);
      if (!task) return null;
      return {
        id,
        type: 'task.disputed',
        chain: 'solana',
        cluster,
        resource: { type: 'task', id: task },
        payload: {
          task_id: task,
          client: readString(data, 'client'),
          timestamp: readNumeric(data, 'timestamp'),
          signature: row.signature,
          slot: row.slot,
        },
      };
    }
    case 'BidRevealed': {
      const task = bytesArrayToHex(data.task_id);
      const bidder = readString(data, 'bidder');
      if (!task || !bidder) return null;
      return {
        id,
        type: 'bid.revealed',
        chain: 'solana',
        cluster,
        resource: { type: 'bid', id: `${task}:${bidder}` },
        payload: {
          task_id: task,
          bidder,
          amount: readNumeric(data, 'amount'),
          signature: row.signature,
          slot: row.slot,
        },
      };
    }
    case 'StreamWithdrawn': {
      const agent = bytesArrayToHex(data.agent_did);
      if (!agent) return null;
      return {
        id,
        type: 'stream.withdrawn',
        chain: 'solana',
        cluster,
        resource: { type: 'stream', id: agent },
        payload: {
          agent_did: agent,
          claimable: readNumeric(data, 'claimable'),
          swapped: data.swapped === true,
          timestamp: readNumeric(data, 'timestamp'),
          signature: row.signature,
          slot: row.slot,
        },
      };
    }
    case 'AgentRegistered':
    case 'ManifestUpdated': {
      const agent = bytesArrayToHex(data.agent_did);
      if (!agent) return null;
      return {
        id,
        type: 'agent.status_changed',
        chain: 'solana',
        cluster,
        resource: { type: 'agent', id: agent },
        payload: {
          agent_did: agent,
          change: row.event_name === 'AgentRegistered' ? 'registered' : 'manifest_updated',
          operator: readString(data, 'operator'),
          version: readNumeric(data, 'version'),
          capability_mask: readNumeric(data, 'capability_mask'),
          stake_amount: readNumeric(data, 'stake_amount'),
          timestamp: readNumeric(data, 'timestamp'),
          signature: row.signature,
          slot: row.slot,
        },
      };
    }
    default:
      return null;
  }
}

export const CURSOR_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS webhook_event_cursor (
    id              SMALLINT PRIMARY KEY DEFAULT 1,
    last_event_id   BIGINT   NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (id = 1)
  );
  INSERT INTO webhook_event_cursor (id, last_event_id) VALUES (1, 0)
    ON CONFLICT (id) DO NOTHING;
`;

export interface WebhookEventProducerDeps {
  db: ProducerDb;
  hub: WebhookHub;
  log: Logger;
  cluster: string;
  intervalMs?: number;
  batchSize?: number;
}

export class WebhookEventProducer {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly intervalMs: number;
  private readonly batchSize: number;

  constructor(private readonly deps: WebhookEventProducerDeps) {
    this.intervalMs = deps.intervalMs ?? 5_000;
    this.batchSize = deps.batchSize ?? 100;
  }

  async ensureSchema(): Promise<void> {
    await this.deps.db.query(CURSOR_TABLE_DDL);
  }

  start(): void {
    if (this.timer) return;
    const tick = () => {
      void this.runOnce().catch((err) => {
        this.deps.log.error(
          { err: err instanceof Error ? err.message : String(err) },
          'webhook producer tick failed',
        );
      });
    };
    this.timer = setInterval(tick, this.intervalMs);
    tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<{ emitted: number; cursor: string }> {
    if (this.running) return { emitted: 0, cursor: '0' };
    this.running = true;
    try {
      const cursorRows = await this.deps.db.query<{ last_event_id: string }>(
        'SELECT last_event_id FROM webhook_event_cursor WHERE id = 1',
      );
      const cursor = cursorRows[0]?.last_event_id ?? '0';

      const rows = (await this.deps.db.query<Record<string, unknown>>(
        `SELECT id, signature, slot::text AS slot, program_id, event_name, data
         FROM program_events
         WHERE id > $1::bigint AND event_name = ANY($2::text[])
         ORDER BY id ASC
         LIMIT $3`,
        [cursor, MAPPED_EVENTS, this.batchSize],
      )) as unknown as ProgramEventRow[];

      if (rows.length === 0) return { emitted: 0, cursor };

      let emitted = 0;
      let latest = cursor;
      for (const row of rows) {
        const input = mapEventRow(row, this.deps.cluster);
        if (input) {
          const result = await this.deps.hub.emit(input);
          if (!result.duplicate) emitted += 1;
        }
        latest = row.id;
      }

      await this.deps.db.query(
        'UPDATE webhook_event_cursor SET last_event_id = $1::bigint, updated_at = now() WHERE id = 1',
        [latest],
      );

      return { emitted, cursor: latest };
    } finally {
      this.running = false;
    }
  }
}
