import { describe, expect, it } from 'vitest';
import { Connection, Keypair } from '@solana/web3.js';
import {
  saepBidAction,
  saepListTasksAction,
  saepPlugin,
  saepRegisterAgentAction,
  saepSubmitResultAction,
} from '../actions.js';
import type { SakAgentLike } from '../types.js';

function fakeAgent(): SakAgentLike {
  const kp = Keypair.generate();
  return {
    wallet: {
      publicKey: kp.publicKey,
      signTransaction: async (tx) => tx,
    },
    connection: new Connection('https://api.devnet.solana.com', 'confirmed'),
  };
}

describe('sak-plugin actions', () => {
  it('plugin exposes M1 action set', () => {
    const names = saepPlugin('devnet').map((a) => a.name);
    expect(names).toEqual([
      'SAEP_REGISTER_AGENT',
      'SAEP_LIST_TASKS',
      'SAEP_BID',
      'SAEP_SUBMIT_RESULT',
    ]);
  });

  it('register_agent requires capability_bits', () => {
    const a = saepRegisterAgentAction('devnet');
    expect(() => a.schema.parse({ metadata_uri: 'https://ex.com' })).toThrow();
    expect(() =>
      a.schema.parse({ capability_bits: [], metadata_uri: 'https://ex.com' }),
    ).toThrow();
  });

  it('register_agent validates metadata_uri format', () => {
    const a = saepRegisterAgentAction('devnet');
    expect(() =>
      a.schema.parse({ capability_bits: [0], metadata_uri: 'not-a-url' }),
    ).toThrow();
  });

  it('list_tasks defaults limit to 20', () => {
    const parsed = saepListTasksAction('devnet').schema.parse({});
    expect(parsed).toHaveProperty('limit', 20);
  });

  it('bid rejects non-base58 task_id', () => {
    const a = saepBidAction('devnet');
    expect(() =>
      a.schema.parse({ task_id: 'bad!!!', amount_usdc_micro: 1000 }),
    ).toThrow();
  });

  it('submit_result rejects empty proof_ref', () => {
    const a = saepSubmitResultAction('devnet');
    expect(() =>
      a.schema.parse({
        task_id: '11111111111111111111111111111111',
        result_cid: 'ipfs://x',
        proof_ref: '',
      }),
    ).toThrow();
  });

  it('each handler returns NOT_YET_WIRED sentinel with cluster tag', async () => {
    const agent = fakeAgent();
    const out = (await saepBidAction('devnet').handler(agent, {
      task_id: '11111111111111111111111111111111',
      amount_usdc_micro: 500_000,
    })) as { error: string; cluster: string };
    expect(out.error).toBe('NOT_YET_WIRED');
    expect(out.cluster).toBe('devnet');
  });

  it('every action carries examples and similes', () => {
    for (const a of saepPlugin('devnet')) {
      expect(a.similes.length).toBeGreaterThan(0);
      expect(a.examples.length).toBeGreaterThan(0);
      expect(a.description.length).toBeGreaterThan(10);
    }
  });
});
