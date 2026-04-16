import * as anchor from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { expect } from 'chai';
import { PROGRAM_IDS } from './helpers/accounts';

// Pre-audit 03: circom-bound, category-scoped reputation.
// PDA derivation + direct-caller rejection contract-level checks.
// Full on-chain flow is gated on anchor-test localnet + proof-gen service, so the
// end-to-end path is marked `it.skip` until the harness can fund a proof and
// warp the VK timelock (same constraint as `tests/e2e_happy_path.ts`).

const repPda = (
  agentDid: Uint8Array,
  capabilityBit: number,
): [PublicKey, number] => {
  const bit = new Uint8Array(2);
  bit[0] = capabilityBit & 0xff;
  bit[1] = (capabilityBit >> 8) & 0xff;
  return PublicKey.findProgramAddressSync(
    [Buffer.from('rep'), Buffer.from(agentDid), Buffer.from(bit)],
    PROGRAM_IDS.agent_registry,
  );
};

const repAuthorityPda = (): [PublicKey, number] =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('rep_authority')],
    PROGRAM_IDS.proof_verifier,
  );

describe('pre-audit-03: reputation_proof_bound', () => {
  it('category reputation PDA is deterministic + distinct per bit', () => {
    const did = new Uint8Array(32).fill(9);
    const [a] = repPda(did, 3);
    const [b] = repPda(did, 3);
    const [c] = repPda(did, 4);
    expect(a.toBase58()).to.equal(b.toBase58());
    expect(a.toBase58()).to.not.equal(c.toBase58());
  });

  it('category reputation PDA changes with agent_did', () => {
    const bit = 7;
    const [a] = repPda(new Uint8Array(32).fill(1), bit);
    const [b] = repPda(new Uint8Array(32).fill(2), bit);
    expect(a.toBase58()).to.not.equal(b.toBase58());
  });

  it('rep_authority PDA is derived from proof_verifier program id', () => {
    const [a] = repAuthorityPda();
    const [b] = repAuthorityPda();
    expect(a.toBase58()).to.equal(b.toBase58());
  });

  it.skip('direct call to agent_registry.update_reputation is rejected', () => {
    // STUB-CPI-GATED: requires localnet deploy. Invariant: signer that is
    // NOT the proof_verifier rep_authority PDA must produce
    // `UnauthorizedReputationUpdate`. Covered by the handler's
    // require_keys_eq against expected_authority.
  });

  it.skip('proof_verifier CPI path updates CategoryReputation exactly once per task_id', () => {
    // STUB-CPI-GATED: depends on localnet + proof-gen + VK activation
    // (bankrun warp). Asserts:
    //  1. verify_and_update_reputation CPI succeeds with a valid Groth16 proof.
    //  2. Second call with identical task_id returns `ReputationReplay`.
    //  3. Second call with a different task_id + same category succeeds and
    //     increments jobs_completed.
  });

  it.skip('capability_bit > 127 rejected by update_reputation', () => {
    // STUB-CPI-GATED: `InvalidCapabilityBit` error when bit exceeds MAX_CAPABILITY_BIT.
  });

  it.skip('bit not set in agent capability_mask rejected', () => {
    // STUB-CPI-GATED: `CapabilityNotDeclared` error when the agent never
    // declared the capability the proof claims to grade.
  });
});
