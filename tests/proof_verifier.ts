import * as anchor from '@coral-xyz/anchor';
import { expect } from 'chai';
import { getProvider } from './helpers/setup';
import { proofVerifier, PROGRAM_IDS } from './helpers/accounts';
import {
  computeVkId,
  g1ToBytes,
  g2ToBytes,
  loadDevVk,
  padLabel,
  DEFAULT_CIRCUIT_LABEL,
} from './helpers/vk';
import type { ProofVerifier } from '../target/types/proof_verifier';

// CU-MEASURE-PENDING

const CIRCUIT_LABEL = DEFAULT_CIRCUIT_LABEL;

describe('proof_verifier', () => {
  const provider = getProvider();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const idl = require('../target/idl/proof_verifier.json');
  const program = new anchor.Program<ProofVerifier>(idl, provider);

  const authority = provider.wallet;
  const vkId = computeVkId(CIRCUIT_LABEL);
  const [vkPda] = proofVerifier.vk(vkId);

  it('program id matches Anchor.toml', () => {
    expect(program.programId.toBase58()).to.equal(PROGRAM_IDS.proof_verifier.toBase58());
  });

  it('init_config: creates verifier config + mode', async () => {
    try {
      await program.methods
        .initConfig(authority.publicKey, false)
        .accountsPartial({ payer: authority.publicKey })
        .rpc();
    } catch (e) {
      if (!String(e).includes('already in use')) throw e;
    }
    const [cfgPda] = proofVerifier.config();
    const cfg = await program.account.verifierConfig.fetch(cfgPda);
    expect(cfg.paused).to.equal(false);
  });

  it('register_vk: registers real dev-ceremony VK on-chain', async () => {
    const vkJson = loadDevVk();
    const alphaG1 = g1ToBytes(vkJson.vk_alpha_1);
    const betaG2 = g2ToBytes(vkJson.vk_beta_2);
    const gammaG2 = g2ToBytes(vkJson.vk_gamma_2);
    const deltaG2 = g2ToBytes(vkJson.vk_delta_2);
    const ic = vkJson.IC.map((p: [string, string, string]) => g1ToBytes(p));
    const numPublicInputs = vkJson.nPublic;
    const circuitLabel = padLabel(CIRCUIT_LABEL);

    try {
      await program.methods
        .registerVk(
          Array.from(vkId) as unknown as number[],
          alphaG1 as unknown as number[],
          betaG2 as unknown as number[],
          gammaG2 as unknown as number[],
          deltaG2 as unknown as number[],
          ic as unknown as number[][],
          numPublicInputs,
          circuitLabel as unknown as number[],
          false,
        )
        .accountsPartial({
          authority: authority.publicKey,
          payer: authority.publicKey,
        })
        .rpc({ commitment: 'confirmed' });
    } catch (e) {
      if (!String(e).includes('already in use')) throw e;
    }

    const vkAccount = await program.account.verifierKey.fetch(vkPda);
    expect(Buffer.from(vkAccount.vkId)).to.deep.equal(vkId);
    expect(vkAccount.numPublicInputs).to.equal(numPublicInputs);
    expect(vkAccount.isProduction).to.equal(false);
    expect(vkAccount.ic.length).to.equal(numPublicInputs + 1);
    expect(Buffer.from(vkAccount.circuitLabel).toString('utf-8').replace(/\0+$/, ''))
      .to.equal(CIRCUIT_LABEL);
  });

  it('propose_vk_activation: sets pending VK with 7-day timelock', async () => {
    const [cfgPda] = proofVerifier.config();
    const [modePda] = proofVerifier.mode();

    await program.methods
      .proposeVkActivation()
      .accountsPartial({
        vk: vkPda,
        mode: modePda,
        authority: authority.publicKey,
      })
      .rpc({ commitment: 'confirmed' });

    const cfg = await program.account.verifierConfig.fetch(cfgPda);
    expect(cfg.pendingVk?.toBase58()).to.equal(vkPda.toBase58());
    expect(cfg.pendingActivatesAt.toNumber()).to.be.greaterThan(0);
  });

  // execute_vk_activation 7-day timelock coverage lives in
  // `tests/bankrun_timelocks.ts` (in-process clock warp, no localnet).

  it.skip('verify_proof: happy-path with real VK + real proof (integration-gated)', async () => {
    // Needs: VK activated (requires bankrun for timelock warp),
    // real proof from proof-gen service, localnet with alt_bn128 syscall.
  });
});
