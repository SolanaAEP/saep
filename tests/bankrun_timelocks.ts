import * as anchor from '@coral-xyz/anchor';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';

import { proofVerifier, PROGRAM_IDS } from './helpers/accounts';
import { startBankrun, loadBankrunProgram, warpClockBy, BankrunEnv } from './helpers/bankrun';
import type { ProofVerifier } from '../target/types/proof_verifier';

const SEVEN_DAYS_SECS = 7 * 24 * 60 * 60;
const CIRCUIT_LABEL = 'task_completion_v1';

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

async function registerDevVk(
  program: anchor.Program<ProofVerifier>,
  authority: anchor.web3.PublicKey,
  vkId: Buffer,
) {
  const vkJson = loadVk();
  const alphaG1 = g1ToBytes(vkJson.vk_alpha_1);
  const betaG2 = g2ToBytes(vkJson.vk_beta_2);
  const gammaG2 = g2ToBytes(vkJson.vk_gamma_2);
  const deltaG2 = g2ToBytes(vkJson.vk_delta_2);
  const ic = vkJson.IC.map((p: [string, string, string]) => g1ToBytes(p));

  await program.methods
    .registerVk(
      Array.from(vkId) as unknown as number[],
      alphaG1 as unknown as number[],
      betaG2 as unknown as number[],
      gammaG2 as unknown as number[],
      deltaG2 as unknown as number[],
      ic as unknown as number[][],
      vkJson.nPublic,
      padLabel(CIRCUIT_LABEL) as unknown as number[],
      false,
    )
    .accountsPartial({ authority, payer: authority })
    .rpc();
}

describe('bankrun: proof_verifier VK rotation timelock', () => {
  let env: BankrunEnv;
  let program: anchor.Program<ProofVerifier>;
  let authority: anchor.web3.PublicKey;

  beforeEach(async () => {
    env = await startBankrun();
    program = loadBankrunProgram<ProofVerifier>('proof_verifier', env.provider);
    authority = env.wallet.publicKey;
  });

  it('program id matches Anchor.toml', () => {
    expect(program.programId.toBase58()).to.equal(PROGRAM_IDS.proof_verifier.toBase58());
  });

  it('full flow: propose → reject before timelock → warp → execute succeeds', async () => {
    const vkId = computeVkId(CIRCUIT_LABEL);
    const [vkPda] = proofVerifier.vk(vkId);
    const [cfgPda] = proofVerifier.config();
    const [modePda] = proofVerifier.mode();

    await program.methods.initConfig(authority, false).accountsPartial({ payer: authority }).rpc();
    await registerDevVk(program, authority, vkId);

    await program.methods
      .proposeVkActivation()
      .accountsPartial({ vk: vkPda, mode: modePda, authority })
      .rpc();

    const afterPropose = await program.account.verifierConfig.fetch(cfgPda);
    expect(afterPropose.pendingVk?.toBase58()).to.equal(vkPda.toBase58());
    expect(afterPropose.activeVk.toBase58()).to.equal(anchor.web3.PublicKey.default.toBase58());
    const proposeNow = Number(
      (await env.context.banksClient.getClock()).unixTimestamp,
    );
    expect(afterPropose.pendingActivatesAt.toNumber()).to.be.gte(proposeNow + SEVEN_DAYS_SECS - 2);

    let preTimelockErr: unknown;
    try {
      await program.methods.executeVkActivation().accountsPartial({ vk: vkPda }).rpc();
    } catch (e) {
      preTimelockErr = e;
    }
    expect(String(preTimelockErr)).to.match(/TimelockNotElapsed/);

    await warpClockBy(env.context, SEVEN_DAYS_SECS + 1);

    await program.methods.executeVkActivation().accountsPartial({ vk: vkPda }).rpc();

    const activated = await program.account.verifierConfig.fetch(cfgPda);
    expect(activated.activeVk.toBase58()).to.equal(vkPda.toBase58());
    expect(activated.pendingVk).to.equal(null);
    expect(activated.pendingActivatesAt.toNumber()).to.equal(0);
  });

  it('cancel during timelock clears pending_vk without activating', async () => {
    const vkId = computeVkId(CIRCUIT_LABEL);
    const [vkPda] = proofVerifier.vk(vkId);
    const [cfgPda] = proofVerifier.config();
    const [modePda] = proofVerifier.mode();

    await program.methods.initConfig(authority, false).accountsPartial({ payer: authority }).rpc();
    await registerDevVk(program, authority, vkId);

    await program.methods
      .proposeVkActivation()
      .accountsPartial({ vk: vkPda, mode: modePda, authority })
      .rpc();

    await program.methods.cancelVkActivation().accountsPartial({ authority }).rpc();

    const cancelled = await program.account.verifierConfig.fetch(cfgPda);
    expect(cancelled.pendingVk).to.equal(null);
    expect(cancelled.pendingActivatesAt.toNumber()).to.equal(0);

    await warpClockBy(env.context, SEVEN_DAYS_SECS + 1);
    let noPendingErr: unknown;
    try {
      await program.methods.executeVkActivation().accountsPartial({ vk: vkPda }).rpc();
    } catch (e) {
      noPendingErr = e;
    }
    expect(String(noPendingErr)).to.match(/NoPendingActivation/);
  });
});
