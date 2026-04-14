import * as anchor from '@coral-xyz/anchor';
import { expect } from 'chai';
import { getProvider } from './helpers/setup';
import { taskMarket, PROGRAM_IDS } from './helpers/accounts';
import type { TaskMarket } from '../target/types/task_market';

// CU-MEASURE-PENDING

describe('task_market', () => {
  const provider = getProvider();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const idl = require('../target/idl/task_market.json');
  const program = new anchor.Program<TaskMarket>(idl, provider);

  it('program id matches Anchor.toml', () => {
    expect(program.programId.toBase58()).to.equal(PROGRAM_IDS.task_market.toBase58());
  });

  it.skip('init_global with agent_registry + treasury + proof_verifier + fee_collector pubkeys',
    async () => {
      // Needs fixtures from the other four programs.
    });

  it.skip('create_task + fund_task (two-step; bundle-style ordering tested separately)',
    async () => {
      // Happy path. Fund mint must be in allowed_payment_mints.
    });

  it.skip('assign: transitions Funded -> InExecution', async () => {
    // STUB-CPI-GATED: agent_registry CPI for agent existence check.
  });

  it.skip('submit_result: agent submits proof_key + result_hash', async () => {
    // STUB-CPI-GATED: proof_verifier CPI.
  });

  it.skip('verify_task: proof_verifier CPI gate', async () => {
    // STUB-CPI-GATED.
  });

  it.skip('release: pays agent treasury, deducts protocol + solrep fees', async () => {
    // STUB-CPI-GATED: treasury_standard + fee_collector CPIs.
  });

  it.skip('raise_dispute: within 24h window (dispute_window_secs)', async () => {
    // Happy path — requires bankrun to test window expiry cleanly.
  });

  it.skip('cancel_unfunded_task: after CANCEL_GRACE_SECS (300s)', async () => {
    // Requires bankrun for deterministic 5-min wait.
  });

  it.skip('expire: after deadline + EXPIRE_GRACE_SECS (3600s)', async () => {
    // Requires bankrun.
  });

  it.skip('state machine: invalid transitions rejected', async () => {
    // e.g. submit_result on Created; release on InExecution without verify.
  });

  it('derives task PDA deterministically', () => {
    const client = anchor.web3.Keypair.generate().publicKey;
    const nonce = new Uint8Array(8).fill(1);
    const [a] = taskMarket.task(client, nonce);
    const [b] = taskMarket.task(client, nonce);
    expect(a.toBase58()).to.equal(b.toBase58());
  });
});
