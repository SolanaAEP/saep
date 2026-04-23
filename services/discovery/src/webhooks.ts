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
  secret_version: number;
  rotated_at: string | null;
  previous_secret_versions: number[];
  status: 'active';
}

export interface WebhookDeliveryRecord {
  id: string;
  subscription_id: string;
  event_id: string;
  event_type: WebhookEventType;
  event_resource_type: WebhookResourceType | null;
  event_resource_id: string | null;
  state: DeliveryState;
  attempt_count: number;
  target_url: string;
  created_at: string;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  completed_at: string | null;
  last_status_code: number | null;
  last_error: string | null;
  signature_version: number | null;
  signature_window_seconds: number | null;
}

type StoredPreviousSecret = {
  version: number;
  secret_preview: string;
  rotated_at: string;
};

type StoredSubscription = WebhookSubscriptionRecord & {
  secret: string;
  previous_secrets: StoredPreviousSecret[];
};

type StoredDelivery = WebhookDeliveryRecord & {
  timer?: unknown;
};

export interface WebhookStateSnapshot {
  subscriptions: StoredSubscription[];
  deliveries: WebhookDeliveryRecord[];
  events: WebhookEvent[];
}

export interface WebhookHubOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  schedule?: (task: ScheduleTask, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
  retryBaseMs?: number;
  maxAttempts?: number;
  signatureWindowSeconds?: number;
  userAgent?: string;
  idFactory?: () => string;
  initialState?: WebhookStateSnapshot;
  persist?: (snapshot: WebhookStateSnapshot) => void;
}

export interface WebhookDeliveryListInput {
  state?: DeliveryState;
  subscription_id?: string;
  event_id?: string;
  event_type?: WebhookEventType;
  limit?: number;
}

export interface WebhookReplayInput {
  event_id?: string;
  since?: string;
  until?: string;
  event_types?: WebhookEventType[];
  subscription_ids?: string[];
  limit?: number;
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
  private readonly signatureWindowSeconds: number;
  private readonly userAgent: string;
  private readonly idFactory: () => string;
  private readonly persist?: (snapshot: WebhookStateSnapshot) => void;

  constructor(opts: WebhookHubOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.schedule = opts.schedule ?? ((task, delayMs) => setTimeout(() => {
      void task();
    }, delayMs));
    this.cancel = opts.cancel ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
    this.retryBaseMs = Math.max(1, opts.retryBaseMs ?? 1_000);
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 4);
    this.signatureWindowSeconds = Math.max(1, opts.signatureWindowSeconds ?? 300);
    this.userAgent = opts.userAgent ?? 'saep-discovery-webhooks/0.1';
    this.idFactory = opts.idFactory ?? randomUUID;
    this.persist = opts.persist;

    if (opts.initialState) {
      for (const subscription of opts.initialState.subscriptions) {
        this.subscriptions.set(subscription.id, normalizeSubscription(subscription));
      }
      for (const event of opts.initialState.events) {
        this.events.set(event.id, { ...event });
      }
      for (const delivery of opts.initialState.deliveries) {
        this.deliveries.set(delivery.id, normalizeDelivery(delivery));
      }
      this.resumePendingDeliveries();
      this.persistState();
    }
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
      secret_version: 1,
      rotated_at: null,
      previous_secret_versions: [],
      status: 'active',
      secret: input.secret,
      previous_secrets: [],
    };
    this.subscriptions.set(id, record);
    this.persistState();
    return sanitizeSubscription(record);
  }

  rotateSubscriptionSecret(id: string, secret: string): WebhookSubscriptionRecord | null {
    const subscription = this.subscriptions.get(id);
    if (!subscription) return null;

    const timestamp = this.isoNow();
    const currentVersion = subscription.secret_version ?? 1;
    const previousSecrets = [
      ...subscription.previous_secrets,
      {
        version: currentVersion,
        secret_preview: subscription.secret_preview,
        rotated_at: timestamp,
      },
    ];

    subscription.secret = secret;
    subscription.secret_version = currentVersion + 1;
    subscription.secret_preview = previewSecret(secret);
    subscription.previous_secrets = previousSecrets;
    subscription.previous_secret_versions = previousSecrets.map((entry) => entry.version);
    subscription.rotated_at = timestamp;
    subscription.updated_at = timestamp;
    this.persistState();

    return sanitizeSubscription(subscription);
  }

  listSubscriptions(): WebhookSubscriptionRecord[] {
    return Array.from(this.subscriptions.values())
      .map(sanitizeSubscription)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  listDeliveries(input: DeliveryState | WebhookDeliveryListInput = {}): WebhookDeliveryRecord[] {
    const filters: WebhookDeliveryListInput = typeof input === 'string' ? { state: input } : input;
    const limit = Math.max(1, Math.min(500, filters.limit ?? 100));
    return Array.from(this.deliveries.values())
      .filter((delivery) => !filters.state || delivery.state === filters.state)
      .filter((delivery) => !filters.subscription_id || delivery.subscription_id === filters.subscription_id)
      .filter((delivery) => !filters.event_id || delivery.event_id === filters.event_id)
      .filter((delivery) => !filters.event_type || delivery.event_type === filters.event_type)
      .map(sanitizeDelivery)
      .sort((a, b) => {
        const aTime = a.last_attempt_at ?? a.created_at;
        const bTime = b.last_attempt_at ?? b.created_at;
        return bTime.localeCompare(aTime) || a.id.localeCompare(b.id);
      })
      .slice(0, limit);
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

  async replay(input: WebhookReplayInput): Promise<{
    events: WebhookEvent[];
    deliveries: WebhookDeliveryRecord[];
  }> {
    const limit = Math.max(1, input.limit ?? 50);
    const selectedEvents = Array.from(this.events.values())
      .filter((event) => this.matchesReplay(event, input))
      .sort((a, b) => a.emitted_at.localeCompare(b.emitted_at))
      .slice(0, limit);

    const createdDeliveries: StoredDelivery[] = [];
    for (const event of selectedEvents) {
      const subscriptions = this.matchingSubscriptions(event, input.subscription_ids);
      for (const subscription of subscriptions) {
        createdDeliveries.push(this.createDelivery(subscription, event));
      }
    }

    await Promise.all(createdDeliveries.map((delivery) => this.dispatch(delivery.id)));

    return {
      events: selectedEvents.map((event) => ({ ...event })),
      deliveries: createdDeliveries.map(sanitizeDelivery),
    };
  }

  private createDelivery(
    subscription: StoredSubscription,
    event: WebhookEvent,
  ): StoredDelivery {
    const id = this.idFactory();
    const timestamp = this.isoNow();
    const delivery: StoredDelivery = {
      id,
      subscription_id: subscription.id,
      event_id: event.id,
      event_type: event.type,
      event_resource_type: event.resource.type,
      event_resource_id: event.resource.id,
      state: 'pending',
      attempt_count: 0,
      target_url: subscription.url,
      created_at: timestamp,
      last_attempt_at: null,
      next_attempt_at: null,
      completed_at: null,
      last_status_code: null,
      last_error: null,
      signature_version: null,
      signature_window_seconds: null,
    };
    this.deliveries.set(id, delivery);
    this.persistState();
    return delivery;
  }

  private matchesReplay(event: WebhookEvent, input: WebhookReplayInput): boolean {
    if (input.event_id && event.id !== input.event_id) return false;
    if (input.since && event.emitted_at < input.since) return false;
    if (input.until && event.emitted_at > input.until) return false;
    if (input.event_types && input.event_types.length > 0 && !input.event_types.includes(event.type)) {
      return false;
    }
    return true;
  }

  private matchingSubscriptions(
    event: WebhookEvent,
    subscriptionIds?: string[],
  ): StoredSubscription[] {
    const allowed = subscriptionIds ? new Set(subscriptionIds) : null;
    return Array.from(this.subscriptions.values())
      .filter((subscription) => subscription.events.includes(event.type))
      .filter((subscription) => !allowed || allowed.has(subscription.id));
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
    this.persistState();

    const body = JSON.stringify(event);
    const timestamp = Math.floor(this.now() / 1000).toString();
    const signatureVersion = subscription.secret_version ?? 1;
    delivery.signature_version = signatureVersion;
    delivery.signature_window_seconds = this.signatureWindowSeconds;
    const signature = createHmac('sha256', subscription.secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    try {
      const response = await this.fetchImpl(subscription.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': this.userAgent,
          'x-saep-delivery-id': delivery.id,
          'x-saep-event-id': event.id,
          'x-saep-event-type': event.type,
          'x-saep-event-timestamp': timestamp,
          'x-saep-signature-version': String(signatureVersion),
          'x-saep-signature-window-seconds': String(this.signatureWindowSeconds),
          'x-saep-signature': `sha256=${signature}`,
        },
        body,
      });

      delivery.last_status_code = response.status;
      if (response.ok) {
        delivery.state = 'delivered';
        delivery.completed_at = delivery.last_attempt_at;
        this.persistState();
        return;
      }

      delivery.last_error = `http_${response.status}`;
    } catch (err) {
      delivery.last_error = err instanceof Error ? err.message : String(err);
    }

    if (delivery.attempt_count >= this.maxAttempts) {
      delivery.state = 'dead_letter';
      delivery.completed_at = delivery.last_attempt_at;
      this.persistState();
      return;
    }

    delivery.state = 'retrying';
    const delayMs = this.retryBaseMs * Math.max(1, 2 ** (delivery.attempt_count - 1));
    delivery.next_attempt_at = new Date(this.now() + delayMs).toISOString();
    delivery.timer = this.schedule(() => this.dispatch(delivery.id), delayMs);
    this.persistState();
  }

  private isoNow(): string {
    return new Date(this.now()).toISOString();
  }

  private resumePendingDeliveries(): void {
    for (const delivery of this.deliveries.values()) {
      if (delivery.state !== 'pending' && delivery.state !== 'retrying') continue;
      const delayMs = delivery.next_attempt_at
        ? Math.max(0, Date.parse(delivery.next_attempt_at) - this.now())
        : 0;
      delivery.timer = this.schedule(() => this.dispatch(delivery.id), delayMs);
    }
  }

  private persistState(): void {
    this.persist?.({
      subscriptions: Array.from(this.subscriptions.values()).map((subscription) => ({ ...subscription })),
      deliveries: Array.from(this.deliveries.values()).map((delivery) => sanitizeDelivery(delivery)),
      events: Array.from(this.events.values()).map((event) => ({ ...event })),
    });
  }
}

function sanitizeSubscription(subscription: StoredSubscription): WebhookSubscriptionRecord {
  const { secret: _secret, previous_secrets: _previousSecrets, ...rest } = subscription;
  return {
    ...rest,
    secret_version: rest.secret_version ?? 1,
    rotated_at: rest.rotated_at ?? null,
    previous_secret_versions: subscription.previous_secrets.map((entry) => entry.version),
  };
}

function sanitizeDelivery(delivery: StoredDelivery): WebhookDeliveryRecord {
  const { timer: _timer, ...rest } = delivery;
  return { ...normalizeDelivery(rest) };
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

function normalizeSubscription(subscription: Partial<StoredSubscription> & { id: string }): StoredSubscription {
  const previousSecrets = Array.isArray(subscription.previous_secrets)
    ? subscription.previous_secrets
    : [];
  return {
    id: subscription.id,
    url: subscription.url ?? '',
    events: Array.isArray(subscription.events) ? subscription.events : [],
    description: subscription.description ?? null,
    created_at: subscription.created_at ?? new Date(0).toISOString(),
    updated_at: subscription.updated_at ?? subscription.created_at ?? new Date(0).toISOString(),
    secret_preview: subscription.secret_preview ?? previewSecret(subscription.secret ?? ''),
    secret_version: subscription.secret_version ?? 1,
    rotated_at: subscription.rotated_at ?? null,
    previous_secret_versions: previousSecrets.map((entry) => entry.version),
    status: 'active',
    secret: subscription.secret ?? '',
    previous_secrets: previousSecrets,
  };
}

function normalizeDelivery(delivery: Partial<StoredDelivery> & { id: string }): StoredDelivery {
  return {
    id: delivery.id,
    subscription_id: delivery.subscription_id ?? '',
    event_id: delivery.event_id ?? '',
    event_type: delivery.event_type ?? 'task.created',
    event_resource_type: delivery.event_resource_type ?? null,
    event_resource_id: delivery.event_resource_id ?? null,
    state: delivery.state ?? 'pending',
    attempt_count: delivery.attempt_count ?? 0,
    target_url: delivery.target_url ?? '',
    created_at: delivery.created_at ?? delivery.last_attempt_at ?? new Date(0).toISOString(),
    last_attempt_at: delivery.last_attempt_at ?? null,
    next_attempt_at: delivery.next_attempt_at ?? null,
    completed_at: delivery.completed_at ?? null,
    last_status_code: delivery.last_status_code ?? null,
    last_error: delivery.last_error ?? null,
    signature_version: delivery.signature_version ?? null,
    signature_window_seconds: delivery.signature_window_seconds ?? null,
  };
}
