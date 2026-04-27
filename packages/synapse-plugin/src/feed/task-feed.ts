import type { SynapseWsClient, SynapseTaskEvent, SynapseEventType } from '../synapse-types.js';

export type TaskFeedHandler = (event: SynapseTaskEvent) => void;

export interface TaskFeedOptions {
  channels?: string[];
  eventTypes?: SynapseEventType[];
  pollFallbackMs?: number;
}

export class TaskFeed {
  private ws: SynapseWsClient;
  private unsubscribers: (() => void)[] = [];
  private handlers = new Set<TaskFeedHandler>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private opts: Required<TaskFeedOptions>;

  constructor(ws: SynapseWsClient, opts?: TaskFeedOptions) {
    this.ws = ws;
    this.opts = {
      channels: opts?.channels ?? ['saep:tasks'],
      eventTypes: opts?.eventTypes ?? [],
      pollFallbackMs: opts?.pollFallbackMs ?? 30_000,
    };
  }

  on(handler: TaskFeedHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  start(): void {
    for (const channel of this.opts.channels) {
      const unsub = this.ws.subscribe(channel, (data) => {
        const event = data as SynapseTaskEvent;
        if (this.opts.eventTypes.length > 0 && !this.opts.eventTypes.includes(event.type)) {
          return;
        }
        for (const h of this.handlers) h(event);
      });
      this.unsubscribers.push(unsub);
    }

    this.pollTimer = setInterval(() => {
      if (!this.ws.connected()) {
        this.ws.reconnect().catch((err) => {
          console.error('[task-feed] reconnect failed:', err);
        });
      }
    }, this.opts.pollFallbackMs);
  }

  stop(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
