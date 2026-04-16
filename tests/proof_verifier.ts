import * as anchor from '@coral-xyz/anchor';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { getProvider } from './helpers/setup';
import { proofVerifier, PROGRAM_IDS } from './helpers/accounts';
import type { ProofVerifier } from '../target/types/proof_verifier';

// CU-MEASURE-PENDING

function fieldElementToBytes(decimal: string): Buffer {
  let n = BigInt(decimal);
  const buf = Buffer.alloc(32);
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return buf;
}

function g1ToBytes(point: [string, string, string]): number[] {
  return [...fieldElementToBytes(point[0]), ...fieldElementToBytes(point[1])];
}

function g2ToBytes(point: [[string, string], [string, string], [string, string]]): number[] {
  const x_im = fieldElementToBytes(point[0][1]);
  const x_re = fieldElementToBytes(point[0][0]);
  const y_im = fieldElementToBytes(point[1][1]);
  const y_re = fieldElementToBytes(point[1][0]);
  return [...x_im, ...x_re, ...y_im, ...y_re];
}

function loadVk() {
  const vkPath = resolve(__dirname, '../circuits/task_completion/build/verification_key.json');
  return JSON.parse(readFileSync(vkPath, 'utf-8'));
}

function computeVkId(label: string): Buffer {
  return createHash('sha256').update(label).digest();
}

function padLabel(s: string): number[] {
  const buf = Buffer.alloc(32, 0);
  Buffer.from(s, 'utf8').copy(buf);
  return Array.from(buf);
}

const CIRCUIT_LABEL = 'task_completion_v1';

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
    const vkJson = loadVk();
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
