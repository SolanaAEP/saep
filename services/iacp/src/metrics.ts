import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'iacp_' });

// Topic category keeps label cardinality bounded. The 64-hex id in
// `task.<id>.events` and the 32-44 char pubkey in `agent.<pk>.inbox` would
// otherwise blow the registry up.
export type TopicCategory = 'agent_inbox' | 'task_events' | 'broadcast' | 'system' | 'other';

export function topicCategory(topic: string): TopicCategory {
  if (topic.startsWith('agent.')) return 'agent_inbox';
  if (topic.startsWith('task.')) return 'task_events';
  if (topic.startsWith('broadcast.')) return 'broadcast';
  if (topic.startsWith('system.')) return 'system';
  return 'other';
}

export const publishTotal = new Counter({
  name: 'iacp_publish_total',
  help: 'Envelope publishes by topic category and terminal result',
  labelNames: ['topic', 'result'] as const,
  registers: [registry],
});

export const publishDuration = new Histogram({
  name: 'iacp_publish_duration_seconds',
  help: 'Wall-clock time from publish receipt to stream append',
  labelNames: ['topic', 'path'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const rateLimitedTotal = new Counter({
  name: 'iacp_rate_limited_total',
  help: 'Rate-limited publishes by axis (msg=per-agent, bw=per-socket)',
  labelNames: ['axis', 'path'] as const,
  registers: [registry],
});

export const envelopeRejectedTotal = new Counter({
  name: 'iacp_envelope_rejected_total',
  help: 'Publish rejections by reason',
  labelNames: ['reason', 'path'] as const,
  registers: [registry],
});

export const wsConnections = new Gauge({
  name: 'iacp_ws_connections',
  help: 'Currently connected WebSocket sessions',
  registers: [registry],
});

export const topicSubscribers = new Gauge({
  name: 'iacp_topic_subscribers',
  help: 'Subscribed sockets per topic category',
  labelNames: ['topic'] as const,
  registers: [registry],
});

export const agentLookupCacheSize = new Gauge({
  name: 'iacp_agent_lookup_cache_size',
  help: 'Agent-registry lookup cache entries',
  registers: [registry],
});

export const rateLimiterBucketCount = new Gauge({
  name: 'iacp_rate_limiter_buckets',
  help: 'Active rate-limiter buckets by scope',
  labelNames: ['scope'] as const,
  registers: [registry],
});

export const anchorEnqueuedTotal = new Counter({
  name: 'iacp_anchor_enqueued_total',
  help: 'Envelopes enqueued for on-chain memo anchoring',
  registers: [registry],
});

export const anchorSubmittedTotal = new Counter({
  name: 'iacp_anchor_submitted_total',
  help: 'Anchor memo transactions confirmed on-chain',
  registers: [registry],
});

export const anchorRetriedTotal = new Counter({
  name: 'iacp_anchor_retried_total',
  help: 'Anchor submits retried after transient failure',
  registers: [registry],
});

export const anchorFailedTotal = new Counter({
  name: 'iacp_anchor_failed_total',
  help: 'Anchor submits that exceeded max retries',
  labelNames: ['reason'] as const,
  registers: [registry],
});

export const anchorSkippedTotal = new Counter({
  name: 'iacp_anchor_skipped_total',
  help: 'Envelopes skipped by anchor filter (non-task topic)',
  labelNames: ['topic'] as const,
  registers: [registry],
});

export const anchorDroppedTotal = new Counter({
  name: 'iacp_anchor_dropped_total',
  help: 'Envelopes dropped at enqueue (backpressure or shutdown)',
  labelNames: ['reason'] as const,
  registers: [registry],
});

export const anchorQueueDepth = new Gauge({
  name: 'iacp_anchor_queue_depth',
  help: 'Current depth of anchor submit queue',
  registers: [registry],
});

export const anchorSubmitDuration = new Histogram({
  name: 'iacp_anchor_submit_duration_seconds',
  help: 'Wall-clock time from anchor dequeue to tx confirmation',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

// Max age (seconds) of the oldest pending entry across all topics in a category.
// Sampled by LagSampler via XPENDING; reset to 0 each tick when no pending entries.
export const streamLagSeconds = new Gauge({
  name: 'iacp_stream_lag_seconds',
  help: 'Oldest unacked entry age per topic category (max across topics)',
  labelNames: ['topic'] as const,
  registers: [registry],
});

export const TOPIC_CATEGORIES: readonly TopicCategory[] = [
  'agent_inbox',
  'task_events',
  'broadcast',
  'system',
  'other',
];

export type PublishResult = 'ok' | 'rate_limited' | 'rejected';
export type PublishPath = 'ws' | 'rest';

export function recordPublish(
  path: PublishPath,
  topic: string,
  result: PublishResult,
  durationSeconds?: number,
): void {
  const category = topicCategory(topic);
  publishTotal.inc({ topic: category, result });
  if (durationSeconds !== undefined) {
    publishDuration.observe({ topic: category, path }, durationSeconds);
  }
}

export function recordRejection(path: PublishPath, reason: string): void {
  envelopeRejectedTotal.inc({ reason, path });
}

export function recordRateLimited(path: PublishPath, axis: 'msg' | 'bw'): void {
  rateLimitedTotal.inc({ axis, path });
}

export function recordAnchorEnqueued(): void {
  anchorEnqueuedTotal.inc();
}

export function recordAnchorSubmitted(durationSeconds: number): void {
  anchorSubmittedTotal.inc();
  anchorSubmitDuration.observe(durationSeconds);
}

export function recordAnchorRetried(): void {
  anchorRetriedTotal.inc();
}

export function recordAnchorFailed(reason: 'max_retries' | 'fatal'): void {
  anchorFailedTotal.inc({ reason });
}

export function recordAnchorSkipped(topic: TopicCategory): void {
  anchorSkippedTotal.inc({ topic });
}

export function recordAnchorDropped(reason: 'queue_full' | 'not_running'): void {
  anchorDroppedTotal.inc({ reason });
}

export function setAnchorQueueDepth(depth: number): void {
  anchorQueueDepth.set(depth);
}
