import { describe, expect, it } from 'vitest';
import { Keypair, Connection } from '@solana/web3.js';
import { createHandlerContext } from '@saep/handlers';
import { buildSynapseTools } from '../tools.js';

function fakeOpts() {
  const kp = Keypair.generate();
  return {
    cluster: 'devnet' as const,
    connection: new Connection('https://api.devnet.solana.com', 'confirmed'),
    wallet: {
      publicKey: kp.publicKey,
      signTransaction: async <T>(tx: T) => tx,
    },
    synapse: { rpcUrl: 'http://localhost:8550' },
  };
}

describe('buildSynapseTools', () => {
  it('returns all 10 tools', () => {
    const opts = fakeOpts();
    const ctx = createHandlerContext(opts.cluster, opts.connection, opts.wallet);
    const tools = buildSynapseTools(opts, ctx);
    expect(tools.length).toBe(10);
  });

  it('tool names match expected set', () => {
    const opts = fakeOpts();
    const ctx = createHandlerContext(opts.cluster, opts.connection, opts.wallet);
    const names = buildSynapseTools(opts, ctx).map((t) => t.name);
    expect(names).toEqual([
      'saep_register_agent',
      'saep_discover_tasks',
      'saep_get_task',
      'saep_my_tasks',
      'saep_get_reputation',
      'saep_bid',
      'saep_reveal_bid',
      'saep_submit_result',
      'saep_claim_payout',
      'saep_withdraw_earnings',
    ]);
  });

  it('every tool has description and parameters', () => {
    const opts = fakeOpts();
    const ctx = createHandlerContext(opts.cluster, opts.connection, opts.wallet);
    for (const tool of buildSynapseTools(opts, ctx)) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.handler).toBe('function');
    }
  });

  it('tool parameters have correct JSON schema shape', () => {
    const opts = fakeOpts();
    const ctx = createHandlerContext(opts.cluster, opts.connection, opts.wallet);
    for (const tool of buildSynapseTools(opts, ctx)) {
      const params = tool.parameters as { type: string; properties: Record<string, unknown> };
      expect(params.type).toBe('object');
      expect(params.properties).toBeDefined();
    }
  });
});
