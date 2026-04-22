import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../server.js';
import { WebhookHub } from '../webhooks.js';

describe('discovery webhooks routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates subscriptions and delivers signed events', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    const hub = new WebhookHub({
      fetchImpl: fetchMock,
      retryBaseMs: 10,
      maxAttempts: 2,
      idFactory: sequentialIds(),
    });
    const app = await buildServer({
      installSignalHandlers: false,
      webhookHub: hub,
      webhookAdminToken: 'admin-token',
      webhookServiceToken: 'service-token',
    });

    const create = await app.inject({
      method: 'POST',
      url: '/webhooks/subscriptions',
      headers: { 'x-saep-admin-token': 'admin-token' },
      payload: {
        url: 'https://hooks.example/saep',
        events: ['task.created'],
        secret: 'super-secret-token',
        description: 'ops sink',
      },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json()).toMatchObject({
      url: 'https://hooks.example/saep',
      events: ['task.created'],
      secret_preview: 'supe...oken',
    });

    const emit = await app.inject({
      method: 'POST',
      url: '/webhooks/events',
      headers: { 'x-saep-service-token': 'service-token' },
      payload: {
        type: 'task.created',
        chain: 'solana',
        cluster: 'devnet',
        resource: { type: 'task', id: 'task-123' },
        payload: { reward_lamports: '1000' },
      },
    });
    expect(emit.statusCode).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call).toBeDefined();
    const init = call[1];
    expect(init.method).toBe('POST');
    const body = init.body as string;
    const headers = init.headers as Record<string, string>;
    expect(headers['x-saep-event-type']).toBe('task.created');
    expect(headers['x-saep-event-id']).toBe('id-2');
    const expectedSignature = createHmac('sha256', 'super-secret-token')
      .update(`${headers['x-saep-event-timestamp']}.${body}`)
      .digest('hex');
    expect(headers['x-saep-signature']).toBe(`sha256=${expectedSignature}`);

    const deliveries = await app.inject({
      method: 'GET',
      url: '/webhooks/deliveries',
      headers: { 'x-saep-admin-token': 'admin-token' },
    });
    expect(deliveries.statusCode).toBe(200);
    expect(deliveries.json()).toMatchObject({
      items: [
        {
          state: 'delivered',
          event_type: 'task.created',
          attempt_count: 1,
          target_url: 'https://hooks.example/saep',
        },
      ],
    });

    await app.close();
  });

  it('rejects missing auth on protected endpoints', async () => {
    const app = await buildServer({
      installSignalHandlers: false,
      webhookHub: new WebhookHub(),
      webhookAdminToken: 'admin-token',
      webhookServiceToken: 'service-token',
    });

    const create = await app.inject({
      method: 'POST',
      url: '/webhooks/subscriptions',
      payload: {
        url: 'https://hooks.example/saep',
        events: ['task.created'],
        secret: 'super-secret-token',
      },
    });
    expect(create.statusCode).toBe(401);

    const emit = await app.inject({
      method: 'POST',
      url: '/webhooks/events',
      payload: {
        type: 'task.created',
        resource: { type: 'task', id: 'task-123' },
        payload: {},
      },
    });
    expect(emit.statusCode).toBe(401);

    await app.close();
  });
});

describe('WebhookHub retry behavior', () => {
  it('retries and dead-letters after the final failed attempt', async () => {
    const scheduled: Array<ScheduleEntry> = [];
    const fetchMock = vi.fn(async () => new Response('nope', { status: 503 }));
    const hub = new WebhookHub({
      fetchImpl: fetchMock,
      retryBaseMs: 5,
      maxAttempts: 2,
      schedule: (task, delayMs) => {
        scheduled.push({ task, delayMs });
        return scheduled.length;
      },
      cancel: () => undefined,
      idFactory: sequentialIds(),
    });

    hub.createSubscription({
      url: 'https://hooks.example/saep',
      events: ['task.created'],
      secret: 'super-secret-token',
    });

    const emitted = await hub.emit({
      type: 'task.created',
      chain: 'solana',
      cluster: 'devnet',
      resource: { type: 'task', id: 'task-123' },
      payload: {},
    });

    expect(emitted.deliveries[0]?.state).toBe('retrying');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delayMs).toBe(5);

    await scheduled[0]!.task();

    const delivery = hub.listDeliveries()[0];
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(delivery).toMatchObject({
      state: 'dead_letter',
      attempt_count: 2,
      last_status_code: 503,
      last_error: 'http_503',
    });
  });
});

interface ScheduleEntry {
  task: () => Promise<void> | void;
  delayMs: number;
}

function sequentialIds(): () => string {
  let counter = 0;
  return () => `id-${++counter}`;
}
