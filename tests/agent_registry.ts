import * as anchor from '@coral-xyz/anchor';
import { expect } from 'chai';
import { getProvider } from './helpers/setup';
import { agentReg, PROGRAM_IDS } from './helpers/accounts';
import type { AgentRegistry } from '../target/types/agent_registry';

describe('agent_registry', () => {
  const provider = getProvider();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const idl = require('../target/idl/agent_registry.json');
  const program = new anchor.Program<AgentRegistry>(idl, provider);

  it('program id matches Anchor.toml', () => {
    expect(program.programId.toBase58()).to.equal(PROGRAM_IDS.agent_registry.toBase58());
  });

  it.skip('register_agent: rejects unapproved capability bits', async () => {
    // FIXTURE-NEEDED: requires both programs deployed on localnet.
    // Setup: capability_registry initialized + tag(s) proposed/activated,
    // stake mint created, operator ATA funded. Then:
    //  1. register_agent with valid mask subset → succeeds
    //  2. register_agent with retired/unallocated bits → InvalidCapability
    //  3. update_manifest with unapproved bits → InvalidCapability
  });

  it.skip('stake: deposits into stake vault PDA', async () => {
    // Depends on register_agent fixture above.
  });

  it.skip('slash: respects 10% cap (MAX_SLASH_BPS_CAP = 1000 bps)', async () => {
    // STUB-CPI-GATED: slash timelock + dispute_arbitration authority check stubbed.
  });

  it.skip('slash timelock: 30-day window (SLASH_TIMELOCK_SECS)', async () => {
    // Requires bankrun adapter — real-time 30-day wait is not feasible.
    // warpSeconds() caps at 30s for localnet to fail fast.
  });

  it.skip('2-step withdrawal (request -> finalize)', async () => {
    // Depends on stake fixture.
  });

  it.skip('reputation update (EWMA) within bounds', async () => {
    // Depends on task_market CPI. STUB-CPI-GATED.
  });

  // Deterministic helper sanity check — PDA derivation should round-trip.
  it('derives agent PDA deterministically', () => {
    const op = anchor.web3.Keypair.generate().publicKey;
    const id = new Uint8Array(32).fill(7);
    const [a] = agentReg.agent(op, id);
    const [b] = agentReg.agent(op, id);
    expect(a.toBase58()).to.equal(b.toBase58());
  });
});
