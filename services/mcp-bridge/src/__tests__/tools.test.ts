import { describe, expect, it, beforeEach } from 'vitest';
import {
  buildTools,
  ListTasksArgs,
  GetTaskArgs,
  GetReputationArgs,
  BidOnTaskArgs,
  SubmitResultArgs,
  _resetVelocityWindow,
} from '../tools.js';
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
      'reveal_bid',
      'submit_result',
    ]);
  });

  it('validates list_tasks args — capability_bit upper bound', () => {
    expect(() => ListTasksArgs.parse({ capability_bit: 128 })).toThrow();
    expect(ListTasksArgs.parse({})).toHaveProperty('limit', 20);
  });

  it('list_tasks accepts allowed status enum, rejects others', () => {
    expect(() => ListTasksArgs.parse({ status: 'nope' })).toThrow();
    expect(ListTasksArgs.parse({ status: 'settled' }).status).toBe('settled');
  });

  it('get_task rejects non-base58 task_address', () => {
    expect(() => GetTaskArgs.parse({ task_address: 'not-base58!!!' })).toThrow();
  });

  it('get_reputation requires hex32 agent_did_hex', () => {
    expect(() => GetReputationArgs.parse({ agent_did_hex: 'xx' })).toThrow();
    const pk = 'a'.repeat(64);
    expect(GetReputationArgs.parse({ agent_did_hex: pk }).agent_did_hex).toBe(pk);
  });

  it('submit_result requires hex32 fields', () => {
    expect(() =>
      SubmitResultArgs.parse({
        task_address: '11111111111111111111111111111111',
        result_hash: 'zz',
        proof_key: '00'.repeat(32),
      }),
    ).toThrow();
    expect(() =>
      SubmitResultArgs.parse({
        task_address: '11111111111111111111111111111111',
        result_hash: '00'.repeat(32),
        proof_key: '00'.repeat(32),
      }),
    ).not.toThrow();
  });

  it('bid_on_task rejects zero / negative amount', () => {
    expect(() =>
      BidOnTaskArgs.parse({
        task_address: '11111111111111111111111111111111',
        amount_usdc_micro: 0,
        agent_did_hex: 'a'.repeat(64),
        bidder_token_account: '9oRq6WnTcNP7UoLyAdDK3V4EEq8pswYnBsbT7FwXeJE3',
      }),
    ).toThrow();
  });

  it('bid_on_task requires agent_did_hex + bidder_token_account', () => {
    expect(() =>
      BidOnTaskArgs.parse({
        task_address: '11111111111111111111111111111111',
        amount_usdc_micro: 500_000,
      }),
    ).toThrow();
    expect(() =>
      BidOnTaskArgs.parse({
        task_address: '11111111111111111111111111111111',
        amount_usdc_micro: 500_000,
        agent_did_hex: 'a'.repeat(64),
        bidder_token_account: '9oRq6WnTcNP7UoLyAdDK3V4EEq8pswYnBsbT7FwXeJE3',
      }),
    ).not.toThrow();
  });

  it('reveal_bid validates nonce_hex shape', () => {
    const reveal = byName.get('reveal_bid')!;
    expect(reveal).toBeDefined();
    expect(() =>
      reveal.handler(
        {
          task_address: '11111111111111111111111111111111',
          amount_usdc_micro: 500_000,
          nonce_hex: 'xx',
        },
        cfg,
      ),
    ).rejects.toThrow();
  });

  it('list_tasks handler short-circuits capability_bit with CAPABILITY_FILTER_NOT_SUPPORTED', async () => {
    const out = (await byName.get('list_tasks')!.handler({ capability_bit: 2 }, cfg)) as {
      error: string;
      tasks: unknown[];
    };
    expect(out.error).toBe('CAPABILITY_FILTER_NOT_SUPPORTED');
    expect(out.tasks).toEqual([]);
  });

  it('every tool has description + inputSchema', () => {
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.inputSchema).toHaveProperty('type', 'object');
      expect(t.inputSchema).toHaveProperty('properties');
    }
  });
});

describe('mcp-bridge config', () => {
  it('picks devnet default', () => {
    const cfg = loadConfig({});
    expect(cfg.cluster).toBe('devnet');
    expect(cfg.rpcUrl).toContain('devnet');
    expect(cfg.autoSign).toBe(false);
    expect(cfg.keypair).toBeNull();
  });

  it('honors SAEP_AUTO_SIGN=true (requires keypair)', () => {
    expect(() => loadConfig({ SAEP_AUTO_SIGN: 'true' })).toThrow(
      'SAEP_AUTO_SIGN=true requires SAEP_OPERATOR_KEYPAIR',
    );
  });

  it('defaults autoSignMaxLamports to 1_000_000', () => {
    expect(loadConfig({}).autoSignMaxLamports).toBe(1_000_000);
  });

  it('defaults autoSignVelocityLimit to 10', () => {
    expect(loadConfig({}).autoSignVelocityLimit).toBe(10);
  });

  it('parses custom SAEP_AUTO_SIGN_MAX_LAMPORTS', () => {
    const cfg = loadConfig({ SAEP_AUTO_SIGN_MAX_LAMPORTS: '5000000' });
    expect(cfg.autoSignMaxLamports).toBe(5_000_000);
  });

  it('parses custom SAEP_AUTO_SIGN_VELOCITY_LIMIT', () => {
    const cfg = loadConfig({ SAEP_AUTO_SIGN_VELOCITY_LIMIT: '3' });
    expect(cfg.autoSignVelocityLimit).toBe(3);
  });

  it('exposes a provider even without a keypair (read-only mode)', () => {
    const cfg = loadConfig({});
    expect(cfg.provider).toBeDefined();
    expect(cfg.connection).toBeDefined();
  });
});
