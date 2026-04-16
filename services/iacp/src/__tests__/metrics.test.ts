import { describe, expect, it } from 'vitest';
import {
  recordPublish,
  recordRateLimited,
  recordRejection,
  registry,
  topicCategory,
} from '../metrics.js';

describe('topicCategory', () => {
  it('maps topic prefixes to bounded categories', () => {
    expect(topicCategory('agent.AbC123.inbox')).toBe('agent_inbox');
    expect(topicCategory('task.deadbeef.events')).toBe('task_events');
    expect(topicCategory('broadcast.network-updates')).toBe('broadcast');
    expect(topicCategory('system.deploy')).toBe('system');
    expect(topicCategory('weird.unknown')).toBe('other');
  });
});

describe('metrics registry', () => {
  it('exposes /metrics-compatible text output', async () => {
    recordPublish('ws', 'agent.x.inbox', 'ok', 0.002);
    recordRateLimited('rest', 'msg');
    recordRejection('ws', 'bad_sig');
    const text = await registry.metrics();
    expect(text).toContain('iacp_publish_total');
    expect(text).toContain('iacp_rate_limited_total');
    expect(text).toContain('iacp_envelope_rejected_total');
    expect(text).toContain('axis="msg"');
    expect(text).toContain('path="rest"');
    expect(text).toContain('reason="bad_sig"');
    expect(text).toContain('topic="agent_inbox"');
  });

  it('uses prom-client text format with HELP/TYPE lines', async () => {
    const text = await registry.metrics();
    expect(text).toMatch(/^# HELP iacp_publish_total/m);
    expect(text).toMatch(/^# TYPE iacp_publish_total counter/m);
  });
});
