import crypto from 'node:crypto';
import pino from 'pino';
import { query, queryOne } from './db.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'webhooks' });

const WEBHOOK_EVENTS = [
  'task.created',
  'task.completed',
  'task.disputed',
  'proof.verified',
  'agent.registered',
  'agent.slashed',
  'payment.settled',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookRegistration {
  id: string;
  operator: string;
  url: string;
  events: WebhookEvent[];
  created_at: number;
  active: boolean;
}

export interface WebhookPayload {
  id: string;
  event: string;
  timestamp: number;
  data: object;
}

const MAX_WEBHOOKS_PER_OPERATOR = 10;
const MAX_DELIVERIES_PER_MIN = 100;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1_000;

export function signPayload(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

export function isValidEvent(event: string): event is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(event);
}

export const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS webhook_registrations (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operator      TEXT NOT NULL,
    url           TEXT NOT NULL,
    events        TEXT[] NOT NULL,
    secret_hash   TEXT NOT NULL,
    active        BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_webhook_operator ON webhook_registrations (operator);
  CREATE INDEX IF NOT EXISTS idx_webhook_events ON webhook_registrations USING GIN (events);

  CREATE TABLE IF NOT EXISTS webhook_delivery_log (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id    UUID NOT NULL REFERENCES webhook_registrations(id) ON DELETE CASCADE,
    event         TEXT NOT NULL,
    payload       JSONB NOT NULL,
    status_code   INT,
    attempt       INT NOT NULL DEFAULT 1,
    delivered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    success       BOOLEAN NOT NULL DEFAULT false
  );

  CREATE INDEX IF NOT EXISTS idx_delivery_webhook ON webhook_delivery_log (webhook_id, delivered_at);
`;

export class WebhookManager {
  async init(): Promise<void> {
    const statements = INIT_SQL.split(';').filter((s) => s.trim());
    for (const stmt of statements) {
      await query(stmt);
    }
  }

  async registerWebhook(
    operator: string,
    url: string,
    events: string[],
    secret: string,
  ): Promise<WebhookRegistration> {
    const invalid = events.filter((e) => !isValidEvent(e));
    if (invalid.length > 0) {
      throw new WebhookError(`invalid events: ${invalid.join(', ')}`, 400);
    }
    if (events.length === 0) {
      throw new WebhookError('at least one event required', 400);
    }

    const count = await queryOne<{ total: number }>(
      `SELECT count(*)::int AS total FROM webhook_registrations
       WHERE operator = $1 AND active = true`,
      [operator],
    );
    if ((count?.total ?? 0) >= MAX_WEBHOOKS_PER_OPERATOR) {
      throw new WebhookError(`max ${MAX_WEBHOOKS_PER_OPERATOR} webhooks per operator`, 429);
    }

    const secretHash = crypto.createHash('sha256').update(secret).digest('hex');

    const row = await queryOne<{
      id: string;
      operator: string;
      url: string;
      events: string[];
      created_at: Date;
      active: boolean;
    }>(
      `INSERT INTO webhook_registrations (operator, url, events, secret_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, operator, url, events, created_at, active`,
      [operator, url, events, secretHash],
    );

    if (!row) throw new WebhookError('failed to insert webhook', 500);

    return {
      id: row.id,
      operator: row.operator,
      url: row.url,
      events: row.events as WebhookEvent[],
      created_at: Math.floor(row.created_at.getTime() / 1000),
      active: row.active,
    };
  }

  async removeWebhook(id: string, operator: string): Promise<boolean> {
    const row = await queryOne<{ id: string }>(
      `UPDATE webhook_registrations SET active = false
       WHERE id = $1 AND operator = $2 AND active = true
       RETURNING id`,
      [id, operator],
    );
    return row !== null;
  }

  async listWebhooks(operator: string): Promise<WebhookRegistration[]> {
    const rows = await query<{
      id: string;
      operator: string;
      url: string;
      events: string[];
      created_at: Date;
      active: boolean;
    }>(
      `SELECT id, operator, url, events, created_at, active
       FROM webhook_registrations
       WHERE operator = $1 AND active = true
       ORDER BY created_at DESC`,
      [operator],
    );
    return rows.map((r) => ({
      id: r.id,
      operator: r.operator,
      url: r.url,
      events: r.events as WebhookEvent[],
      created_at: Math.floor(r.created_at.getTime() / 1000),
      active: r.active,
    }));
  }

  async deliverEvent(event: string, payload: object): Promise<void> {
    if (!isValidEvent(event)) return;

    const hooks = await query<{
      id: string;
      url: string;
      secret_hash: string;
    }>(
      `SELECT id, url, secret_hash FROM webhook_registrations
       WHERE active = true AND $1 = ANY(events)`,
      [event],
    );

    const deliveries = hooks.map((hook) => this.deliverToHook(hook, event, payload));
    await Promise.allSettled(deliveries);
  }

  private async deliverToHook(
    hook: { id: string; url: string; secret_hash: string },
    event: string,
    data: object,
  ): Promise<void> {
    if (await this.isRateLimited(hook.id)) {
      log.warn({ webhook_id: hook.id }, 'rate limited, skipping delivery');
      return;
    }

    const envelope: WebhookPayload = {
      id: crypto.randomUUID(),
      event,
      timestamp: Math.floor(Date.now() / 1000),
      data,
    };

    const body = JSON.stringify(envelope);
    // sign with the stored hash as HMAC key (operator proves knowledge of secret via registration;
    // we use the hash so the raw secret is never stored)
    const signature = signPayload(body, hook.secret_hash);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(hook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-SAEP-Signature': signature,
            'X-SAEP-Event': event,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });

        await this.logDelivery(hook.id, event, envelope, res.status, attempt, res.ok);

        if (res.ok) return;
        if (res.status >= 400 && res.status < 500) return; // don't retry client errors
      } catch (err) {
        log.warn(
          { webhook_id: hook.id, attempt, err: err instanceof Error ? err.message : String(err) },
          'delivery failed',
        );
        await this.logDelivery(hook.id, event, envelope, 0, attempt, false);
      }

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
      }
    }
  }

  private async isRateLimited(webhookId: string): Promise<boolean> {
    const row = await queryOne<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM webhook_delivery_log
       WHERE webhook_id = $1 AND delivered_at > now() - interval '1 minute'`,
      [webhookId],
    );
    return (row?.cnt ?? 0) >= MAX_DELIVERIES_PER_MIN;
  }

  private async logDelivery(
    webhookId: string,
    event: string,
    payload: object,
    statusCode: number,
    attempt: number,
    success: boolean,
  ): Promise<void> {
    try {
      await query(
        `INSERT INTO webhook_delivery_log (webhook_id, event, payload, status_code, attempt, success)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [webhookId, event, JSON.stringify(payload), statusCode, attempt, success],
      );
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'failed to log delivery');
    }
  }
}

export class WebhookError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = 'WebhookError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
