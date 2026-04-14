import * as anchor from '@coral-xyz/anchor';
import { expect } from 'chai';
import { getProvider } from './helpers/setup';
import { proofVerifier, PROGRAM_IDS } from './helpers/accounts';
import type { ProofVerifier } from '../target/types/proof_verifier';

// CU-MEASURE-PENDING

describe('proof_verifier', () => {
  const provider = getProvider();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const idl = require('../target/idl/proof_verifier.json');
  const program = new anchor.Program<ProofVerifier>(idl, provider);

  const authority = provider.wallet;

  it('program id matches Anchor.toml', () => {
    expect(program.programId.toBase58()).to.equal(PROGRAM_IDS.proof_verifier.toBase58());
  });

  it('init_config: creates verifier config + mode', async () => {
    try {
      await program.methods
        .initConfig(authority.publicKey, false) // authority, is_mainnet=false
        .accountsPartial({ payer: authority.publicKey })
        .rpc();
    } catch (e) {
      if (!String(e).includes('already in use')) throw e;
    }
    const [cfgPda] = proofVerifier.config();
    const cfg = await program.account.verifierConfig.fetch(cfgPda);
    expect(cfg.paused).to.equal(false);
  });

  it.skip('register_vk: registers a Groth16 BN254 verifying key', async () => {
    // Needs hand-crafted VK from circuits/task-completion dev setup.
    // Alpha/Beta/Gamma/Delta G1/G2 points + IC vec.
  });

  it.skip('rotate_vk: 7-day timelock (VK_ROTATION_TIMELOCK_SECS)', async () => {
    // Requires bankrun adapter — 7-day real-time wait infeasible.
  });

  it.skip('verify_proof: happy-path returns sentinel for stubbed pairing', async () => {
    // STUB-CPI-GATED: pairing check is stubbed (named marker `bn254_pairing`).
    // Current stub should return Ok(()) for well-formed input. Assert that;
    // rewrite when real alt_bn128_pairing syscall is wired.
  });
});
