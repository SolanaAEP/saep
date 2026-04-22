import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_EVENT_TYPES = [
  'task.created',
  'task.verified',
  'task.released',
  'task.disputed',
  'bid.revealed',
  'stream.withdrawn',
  'agent.status_changed',
] as const;

export type WebhookEventType = typeof WEBHOOK_EVENT_TYPES[number];
export type WebhookResourceType = 'task' | 'bid' | 'stream' | 'agent';
export type DeliveryState = 'pending' | 'delivered' | 'retrying' | 'dead_letter';
export type ScheduleTask = () => Promise<void> | void;

export interface WebhookSubscriptionInput {
  url: string;
  events: WebhookEventType[];
  secret: string;
  description?: string | null;
}

export interface WebhookEventInput {
  type: WebhookEventType;
  chain: string;
  cluster: string;
  resource: {
    type: WebhookResourceType;
    id: string;
  };
  payload: Record<string, unknown>;
}

export interface WebhookEvent extends WebhookEventInput {
  id: string;
  emitted_at: string;
}

export interface WebhookSubscriptionRecord {
  id: string;
  url: string;
  events: WebhookEventType[];
  description: string | null;
  created_at: string;
  updated_at: string;
  secret_preview: string;
  status: 'active';
}

export interface WebhookDeliveryRecord {
  id: string;
  subscription_id: string;
  event_id: string;
  event_type: WebhookEventType;
  state: DeliveryState;
  attempt_count: number;
  target_url: string;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  last_status_code: number | null;
  last_error: string | null;
}

type StoredSubscription = WebhookSubscriptionRecord & {
  secret: string;
};

type StoredDelivery = WebhookDeliveryRecord & {
  timer?: unknown;
};

export interface WebhookHubOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  schedule?: (task: ScheduleTask, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
  retryBaseMs?: number;
  maxAttempts?: number;
  userAgent?: string;
  idFactory?: () => string;
}

export class WebhookHub {
  private readonly subscriptions = new Map<string, StoredSubscription>();
  private readonly deliveries = new Map<string, StoredDelivery>();
  private readonly events = new Map<string, WebhookEvent>();
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly schedule: (task: ScheduleTask, delayMs: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private readonly retryBaseMs: number;
  private readonly maxAttempts: number;
  private readonly userAgent: string;
  private readonly idFactory: () => string;

  constructor(opts: WebhookHubOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.schedule = opts.schedule ?? ((task, delayMs) => setTimeout(() => {
      void task();
    }, delayMs));
    this.cancel = opts.cancel ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
    this.retryBaseMs = Math.max(1, opts.retryBaseMs ?? 1_000);
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 4);
    this.userAgent = opts.userAgent ?? 'saep-discovery-webhooks/0.1';
    this.idFactory = opts.idFactory ?? randomUUID;
  }

  createSubscription(input: WebhookSubscriptionInput): WebhookSubscriptionRecord {
    const id = this.idFactory();
    const timestamp = this.isoNow();
    const record: StoredSubscription = {
      id,
      url: input.url,
      events: [...new Set(input.events)],
      description: input.description ?? null,
      created_at: timestamp,
      updated_at: timestamp,
      secret_preview: previewSecret(input.secret),
      status: 'active',
      secret: input.secret,
    };
    this.subscriptions.set(id, record);
    return sanitizeSubscription(record);
  }

  listSubscriptions(): WebhookSubscriptionRecord[] {
    return Array.from(this.subscriptions.values())
      .map(sanitizeSubscription)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  listDeliveries(state?: DeliveryState): WebhookDeliveryRecord[] {
    return Array.from(this.deliveries.values())
      .filter((delivery) => !state || delivery.state === state)
      .map(sanitizeDelivery)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async emit(input: WebhookEventInput): Promise<{
    event: WebhookEvent;
    deliveries: WebhookDeliveryRecord[];
  }> {
    const event: WebhookEvent = {
      id: this.idFactory(),
      emitted_at: this.isoNow(),
      ...input,
    };
    this.events.set(event.id, event);

    const matching = Array.from(this.subscriptions.values())
      .filter((subscription) => subscription.events.includes(event.type));
    const initialDeliveries = matching.map((subscription) => this.createDelivery(subscription, event));

    await Promise.all(initialDeliveries.map((delivery) => this.dispatch(delivery.id)));

    return {
      event,
      deliveries: initialDeliveries.map(sanitizeDelivery),
    };
  }

  private createDelivery(
    subscription: StoredSubscription,
    event: WebhookEvent,
  ): StoredDelivery {
    const id = this.idFactory();
    const delivery: StoredDelivery = {
      id,
      subscription_id: subscription.id,
      event_id: event.id,
      event_type: event.type,
      state: 'pending',
      attempt_count: 0,
      target_url: subscription.url,
      last_attempt_at: null,
      next_attempt_at: null,
      last_status_code: null,
      last_error: null,
    };
    this.deliveries.set(id, delivery);
    return delivery;
  }

  private async dispatch(deliveryId: string): Promise<void> {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) return;
    const subscription = this.subscriptions.get(delivery.subscription_id);
    const event = this.events.get(delivery.event_id);
    if (!subscription || !event) return;

    delivery.timer = undefined;
    delivery.next_attempt_at = null;
    delivery.attempt_count += 1;
    delivery.last_attempt_at = this.isoNow();
    delivery.last_error = null;

    const body = JSON.stringify(event);
    const timestamp = Math.floor(this.now() / 1000).toString();
    const signature = createHmac('sha256', subscription.secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    try {
      const response = await this.fetchImpl(subscription.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': this.userAgent,
          'x-saep-event-id': event.id,
          'x-saep-event-type': event.type,
          'x-saep-event-timestamp': timestamp,
          'x-saep-signature': `sha256=${signature}`,
        },
        body,
      });

      delivery.last_status_code = response.status;
      if (response.ok) {
        delivery.state = 'delivered';
        return;
      }

      delivery.last_error = `http_${response.status}`;
    } catch (err) {
      delivery.last_error = err instanceof Error ? err.message : String(err);
    }

    if (delivery.attempt_count >= this.maxAttempts) {
      delivery.state = 'dead_letter';
      return;
    }

    delivery.state = 'retrying';
    const delayMs = this.retryBaseMs * Math.max(1, 2 ** (delivery.attempt_count - 1));
    delivery.next_attempt_at = new Date(this.now() + delayMs).toISOString();
    delivery.timer = this.schedule(() => this.dispatch(delivery.id), delayMs);
  }

  private isoNow(): string {
    return new Date(this.now()).toISOString();
  }
}

function sanitizeSubscription(subscription: StoredSubscription): WebhookSubscriptionRecord {
  const { secret: _secret, ...rest } = subscription;
  return { ...rest };
}

function sanitizeDelivery(delivery: StoredDelivery): WebhookDeliveryRecord {
  const { timer: _timer, ...rest } = delivery;
  return { ...rest };
}

function previewSecret(secret: string): string {
  if (secret.length <= 8) return `${secret}***`;
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

export function authorizeToken(
  provided: string | undefined,
  expected: string | undefined,
): boolean {
  if (!provided || !expected) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
