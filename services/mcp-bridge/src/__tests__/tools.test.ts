import { describe, expect, it } from 'vitest';
import { buildTools, ListTasksArgs, GetTaskArgs, GetReputationArgs } from '../tools.js';
import { loadConfig } from '../config.js';

describe('mcp-bridge tools', () => {
  const cfg = loadConfig({ SAEP_CLUSTER: 'devnet' });
  const tools = buildTools();
  const byName = new Map(tools.map((t) => [t.name, t]));

  it('exposes the expected tool set', () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      'bid_on_task',
      'get_reputation',
      'get_task',
      'list_tasks',
      'submit_result',
    ]);
  });

  it('validates list_tasks args — capability_bit upper bound', () => {
    expect(() => ListTasksArgs.parse({ capability_bit: 128 })).toThrow();
    expect(ListTasksArgs.parse({})).toHaveProperty('limit', 20);
  });

  it('rejects non-base58 task_id', () => {
    expect(() => GetTaskArgs.parse({ task_id: 'not-base58!!!' })).toThrow();
  });

  it('get_reputation parses valid base58', () => {
    const pk = '11111111111111111111111111111111';
    expect(GetReputationArgs.parse({ agent_did: pk }).agent_did).toBe(pk);
  });

  it('handlers return NOT_YET_WIRED sentinel', async () => {
    const pk = '11111111111111111111111111111111';
    const out = (await byName.get('get_task')!.handler({ task_id: pk }, cfg)) as {
      error: string;
    };
    expect(out.error).toBe('NOT_YET_WIRED');
  });

  it('list_tasks handler returns empty tasks array', async () => {
    const out = (await byName.get('list_tasks')!.handler({}, cfg)) as {
      tasks: unknown[];
    };
    expect(out.tasks).toEqual([]);
  });
});

describe('mcp-bridge config', () => {
  it('picks devnet default', () => {
    const cfg = loadConfig({});
    expect(cfg.cluster).toBe('devnet');
    expect(cfg.rpcUrl).toContain('devnet');
    expect(cfg.autoSign).toBe(false);
  });

  it('honors SAEP_AUTO_SIGN=true', () => {
    expect(loadConfig({ SAEP_AUTO_SIGN: 'true' }).autoSign).toBe(true);
  });
});
