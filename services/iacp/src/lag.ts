import type { Logger } from 'pino';
import {
  streamLagSeconds,
  topicCategory,
  TOPIC_CATEGORIES,
  type TopicCategory,
} from './metrics.js';

export const DEFAULT_LAG_INTERVAL_MS = 15_000;

export interface LagSamplerOptions {
  intervalMs?: number;
  now?: () => number;
}

// Narrow shape we need — avoids depending on ioredis's overload soup, and
// lets tests pass a plain fake without `as unknown as Redis`.
export interface PendingClient {
  xpending(topic: string, group: string): Promise<unknown>;
}

// Polls XPENDING per known topic, parses the oldest pending entry id
// (stream id is `<ms>-<seq>`), and updates iacp_stream_lag_seconds with
// the max lag observed across topics in each category. Topics with no
// pending entries decay the gauge to 0 so a drained backlog doesn't show
// stale lag.
export class LagSampler {
  private handle: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private readonly now: () => number;

  constructor(
    private readonly redis: PendingClient,
    private readonly group: string,
    private readonly getTopics: () => Iterable<string>,
    private readonly log: Logger,
    opts: LagSamplerOptions = {},
  ) {
    this.intervalMs = opts.intervalMs ?? DEFAULT_LAG_INTERVAL_MS;
    this.now = opts.now ?? Date.now;
  }

  start(): void {
    if (this.handle) return;
    this.handle = setInterval(() => {
      void this.tick().catch((err) => {
        this.log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'lag sampler tick failed',
        );
      });
    }, this.intervalMs);
    this.handle.unref?.();
  }

  stop(): void {
    if (!this.handle) return;
    clearInterval(this.handle);
    this.handle = null;
  }

  async tick(): Promise<void> {
    const topics = Array.from(new Set(this.getTopics()));
    const now = this.now();
    const catMax = new Map<TopicCategory, number>();

    for (const topic of topics) {
      const lagS = await this.sampleTopic(topic, now);
      if (lagS === null) continue;
      const cat = topicCategory(topic);
      const prev = catMax.get(cat) ?? 0;
      if (lagS > prev) catMax.set(cat, lagS);
    }

    for (const cat of TOPIC_CATEGORIES) {
      streamLagSeconds.set({ topic: cat }, catMax.get(cat) ?? 0);
    }
  }

  private async sampleTopic(topic: string, now: number): Promise<number | null> {
    let summary: unknown;
    try {
      summary = await this.redis.xpending(topic, this.group);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // NOGROUP = no consumer ever read this topic; not an error, just nothing pending.
      if (msg.includes('NOGROUP')) return 0;
      this.log.warn({ err: msg, topic }, 'xpending failed');
      return null;
    }
    if (!Array.isArray(summary) || summary.length < 2) return 0;
    const count = Number(summary[0]);
    if (!Number.isFinite(count) || count === 0) return 0;
    const minId = summary[1];
    if (typeof minId !== 'string') return 0;
    const dash = minId.indexOf('-');
    const ms = Number(dash > 0 ? minId.slice(0, dash) : minId);
    if (!Number.isFinite(ms) || ms <= 0) return 0;
    return Math.max(0, (now - ms) / 1000);
  }
}
