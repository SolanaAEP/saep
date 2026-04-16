import * as anchor from '@coral-xyz/anchor';
import { expect } from 'chai';

import { proofVerifier, PROGRAM_IDS } from './helpers/accounts';
import { startBankrun, loadBankrunProgram, warpClockBy, BankrunEnv } from './helpers/bankrun';
import { computeVkId, registerDevVk, DEFAULT_CIRCUIT_LABEL } from './helpers/vk';
import type { ProofVerifier } from '../target/types/proof_verifier';

const SEVEN_DAYS_SECS = 7 * 24 * 60 * 60;
const CIRCUIT_LABEL = DEFAULT_CIRCUIT_LABEL;

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
