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

const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const SOME_ATA = '9oRq6WnTcNP7UoLyAdDK3V4EEq8pswYnBsbT7FwXeJE3';

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
      'SAEP_REVEAL_BID',
      'SAEP_SUBMIT_RESULT',
    ]);
  });

  it('register_agent requires capability_bits', () => {
    const a = saepRegisterAgentAction('devnet');
    expect(() =>
      a.schema.parse({
        metadata_uri: 'https://ex.com',
        stake_mint: USDC_DEVNET,
        operator_token_account: SOME_ATA,
      }),
    ).toThrow();
    expect(() =>
      a.schema.parse({
        capability_bits: [],
        metadata_uri: 'https://ex.com',
        stake_mint: USDC_DEVNET,
        operator_token_account: SOME_ATA,
      }),
    ).toThrow();
  });

  it('register_agent validates metadata_uri format', () => {
    const a = saepRegisterAgentAction('devnet');
    expect(() =>
      a.schema.parse({
        capability_bits: [0],
        metadata_uri: 'not-a-url',
        stake_mint: USDC_DEVNET,
        operator_token_account: SOME_ATA,
      }),
    ).toThrow();
  });

  it('register_agent requires stake_mint + operator_token_account', () => {
    const a = saepRegisterAgentAction('devnet');
    expect(() =>
      a.schema.parse({ capability_bits: [0], metadata_uri: 'https://ex.com' }),
    ).toThrow();
  });

  it('list_tasks defaults limit to 20 and allows missing did', () => {
    const parsed = saepListTasksAction('devnet').schema.parse({});
    expect(parsed).toHaveProperty('limit', 20);
    expect(parsed.agent_did_hex).toBeUndefined();
  });

  it('list_tasks validates hex did format when provided', () => {
    const a = saepListTasksAction('devnet');
    expect(() => a.schema.parse({ agent_did_hex: 'xx' })).toThrow();
    expect(() => a.schema.parse({ agent_did_hex: 'a'.repeat(64) })).not.toThrow();
  });

  it('bid rejects non-base58 task_address', () => {
    const a = saepBidAction('devnet');
    expect(() =>
      a.schema.parse({
        task_address: 'bad!!!',
        amount_usdc_micro: 1000,
        agent_did_hex: 'a'.repeat(64),
        bidder_token_account: SOME_ATA,
      }),
    ).toThrow();
  });

  it('bid requires agent_did_hex + bidder_token_account', () => {
    const a = saepBidAction('devnet');
    expect(() =>
      a.schema.parse({
        task_address: '11111111111111111111111111111111',
        amount_usdc_micro: 1000,
      }),
    ).toThrow();
    expect(() =>
      a.schema.parse({
        task_address: '11111111111111111111111111111111',
        amount_usdc_micro: 1000,
        agent_did_hex: 'a'.repeat(64),
        bidder_token_account: SOME_ATA,
      }),
    ).not.toThrow();
  });

  it('submit_result rejects non-hex result_hash + proof_key', () => {
    const a = saepSubmitResultAction('devnet');
    expect(() =>
      a.schema.parse({
        task_address: '11111111111111111111111111111111',
        result_hash: 'zz',
        proof_key: '00'.repeat(32),
      }),
    ).toThrow();
    expect(() =>
      a.schema.parse({
        task_address: '11111111111111111111111111111111',
        result_hash: '00'.repeat(32),
        proof_key: 'nothex',
      }),
    ).toThrow();
    expect(() =>
      a.schema.parse({
        task_address: '11111111111111111111111111111111',
        result_hash: '00'.repeat(32),
        proof_key: '00'.repeat(32),
      }),
    ).not.toThrow();
  });

  it('reveal_bid validates nonce_hex shape', () => {
    const a = saepPlugin('devnet').find((x) => x.name === 'SAEP_REVEAL_BID')!;
    expect(() =>
      a.schema.parse({
        task_address: '11111111111111111111111111111111',
        amount_usdc_micro: 500_000,
        nonce_hex: 'xx',
      }),
    ).toThrow();
    expect(() =>
      a.schema.parse({
        task_address: '11111111111111111111111111111111',
        amount_usdc_micro: 500_000,
        nonce_hex: 'a'.repeat(64),
      }),
    ).not.toThrow();
  });

  it('every action carries examples and similes', () => {
    for (const a of saepPlugin('devnet')) {
      expect(a.similes.length).toBeGreaterThan(0);
      expect(a.examples.length).toBeGreaterThan(0);
      expect(a.description.length).toBeGreaterThan(10);
    }
  });
});
