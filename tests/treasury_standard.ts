import * as anchor from '@coral-xyz/anchor';
import { expect } from 'chai';
import { getProvider } from './helpers/setup';
import { treasury, PROGRAM_IDS } from './helpers/accounts';
import type { TreasuryStandard } from '../target/types/treasury_standard';

// CU-MEASURE-PENDING

describe('treasury_standard', () => {
  const provider = getProvider();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const idl = require('../target/idl/treasury_standard.json');
  const program = new anchor.Program<TreasuryStandard>(idl, provider);

  it('program id matches Anchor.toml', () => {
    expect(program.programId.toBase58()).to.equal(PROGRAM_IDS.treasury_standard.toBase58());
  });

  it.skip('init_global + allowed_mints bootstrap', async () => {
    // Needs: spl-token mint fixture, jupiter_program pubkey (can be a random pk
    // since Jupiter CPI is stubbed), agent_registry global pubkey.
  });

  it.skip('create_treasury: creates AgentTreasury PDA with default limits', async () => {
    // Depends on init_global.
  });

  it.skip('deposit + withdraw within per-tx / daily / weekly caps', async () => {
    // Happy path.
  });

  it.skip('cap violation: per-tx > per_tx_limit errors with TreasuryError::PerTxLimitExceeded',
    async () => {
      // Negative path.
    });

  it.skip('cap violation: daily aggregate > daily_spend_limit rejects', async () => {
    // Requires clock advance to reset-day boundary for positive-case. bankrun.
  });

  it.skip('init_stream: stream bijection invariant (one active stream per treasury)', async () => {
    // Second init_stream should fail while streaming_active=true.
  });

  it.skip('allowed_mints: add + remove lifecycle', async () => {});

  it.skip('Jupiter swap / oracle staleness', async () => {
    // STUB-CPI-GATED: Jupiter CPI + Pyth oracle staleness are stubbed with
    // named markers. Will exercise once pay_task wires real CPI.
  });

  it('derives treasury PDA deterministically', () => {
    const did = new Uint8Array(32).fill(9);
    const [a] = treasury.treasury(did);
    const [b] = treasury.treasury(did);
    expect(a.toBase58()).to.equal(b.toBase58());
  });
});
