import * as anchor from '@coral-xyz/anchor';
import { expect } from 'chai';

import { proofVerifier, PROGRAM_IDS } from './helpers/accounts';
import { startBankrun, loadBankrunProgram, warpClockBy, BankrunEnv } from './helpers/bankrun';
import {
  CU_BUDGETS, assertWithinBudget, logCU, measureCU, printCUSummary, resetCUMeasurements,
} from './helpers/cu';
import { computeVkId, registerDevVk, DEFAULT_CIRCUIT_LABEL } from './helpers/vk';
import type { ProofVerifier } from '../target/types/proof_verifier';

const SEVEN_DAYS_SECS = 7 * 24 * 60 * 60;
const CIRCUIT_LABEL = DEFAULT_CIRCUIT_LABEL;
const ROTATION_LABEL = `${DEFAULT_CIRCUIT_LABEL}_rotation`;

describe('bankrun: proof_verifier VK rotation timelock', () => {
  let env: BankrunEnv;
  let program: anchor.Program<ProofVerifier>;
  let authority: anchor.web3.PublicKey;

  before(resetCUMeasurements);
  after(printCUSummary);

  beforeEach(async () => {
    env = await startBankrun();
    program = loadBankrunProgram<ProofVerifier>('proof_verifier', env.provider);
    authority = env.wallet.publicKey;
  });

  it('program id matches Anchor.toml', () => {
    expect(program.programId.toBase58()).to.equal(PROGRAM_IDS.proof_verifier.toBase58());
  });

  it('first non-mainnet activation executes immediately when no active VK exists', async () => {
    const vkId = computeVkId(CIRCUIT_LABEL);
    const [vkPda] = proofVerifier.vk(vkId);
    const [cfgPda] = proofVerifier.config();
    const [modePda] = proofVerifier.mode();

    const initConfigBuilder = program.methods
      .initConfig(authority, false)
      .accountsPartial({ payer: authority });
    {
      const cu = await measureCU(env.context, initConfigBuilder, env.context.payer);
      logCU('init_config', cu);
      assertWithinBudget('init_config', cu, CU_BUDGETS.init_config);
    }
    await initConfigBuilder.rpc();
    await registerDevVk(program, authority, vkId);

    const proposeBuilder = program.methods
      .proposeVkActivation()
      .accountsPartial({ vk: vkPda, mode: modePda, authority });
    {
      const cu = await measureCU(env.context, proposeBuilder, env.context.payer);
      logCU('propose_vk_activation', cu);
      assertWithinBudget('propose_vk_activation', cu, CU_BUDGETS.propose_vk_activation);
    }
    await proposeBuilder.rpc();

    const afterPropose = await program.account.verifierConfig.fetch(cfgPda);
    expect(afterPropose.pendingVk?.toBase58()).to.equal(vkPda.toBase58());
    expect(afterPropose.activeVk.toBase58()).to.equal(anchor.web3.PublicKey.default.toBase58());
    const proposeNow = Number((await env.context.banksClient.getClock()).unixTimestamp);
    expect(afterPropose.pendingActivatesAt.toNumber()).to.be.lte(proposeNow + 1);

    const executeBuilder = program.methods.executeVkActivation().accountsPartial({ vk: vkPda });
    {
      const cu = await measureCU(env.context, executeBuilder, env.context.payer);
      logCU('execute_vk_activation', cu);
      assertWithinBudget('execute_vk_activation', cu, CU_BUDGETS.execute_vk_activation);
    }
    await executeBuilder.rpc();

    const activated = await program.account.verifierConfig.fetch(cfgPda);
    expect(activated.activeVk.toBase58()).to.equal(vkPda.toBase58());
    expect(activated.pendingVk).to.equal(null);
    expect(activated.pendingActivatesAt.toNumber()).to.equal(0);
  });

  it('subsequent non-mainnet rotations still honor the 7-day timelock', async () => {
    const currentVkId = computeVkId(CIRCUIT_LABEL);
    const nextVkId = computeVkId(ROTATION_LABEL);
    const [currentVkPda] = proofVerifier.vk(currentVkId);
    const [nextVkPda] = proofVerifier.vk(nextVkId);
    const [cfgPda] = proofVerifier.config();
    const [modePda] = proofVerifier.mode();

    await program.methods.initConfig(authority, false).accountsPartial({ payer: authority }).rpc();
    await registerDevVk(program, authority, currentVkId);
    await registerDevVk(program, authority, nextVkId, ROTATION_LABEL);

    await program.methods
      .proposeVkActivation()
      .accountsPartial({ vk: currentVkPda, mode: modePda, authority })
      .rpc();
    await program.methods.executeVkActivation().accountsPartial({ vk: currentVkPda }).rpc();

    await program.methods
      .proposeVkActivation()
      .accountsPartial({ vk: nextVkPda, mode: modePda, authority })
      .rpc();

    const afterPropose = await program.account.verifierConfig.fetch(cfgPda);
    expect(afterPropose.pendingVk?.toBase58()).to.equal(nextVkPda.toBase58());
    expect(afterPropose.activeVk.toBase58()).to.equal(currentVkPda.toBase58());
    const proposeNow = Number((await env.context.banksClient.getClock()).unixTimestamp);
    expect(afterPropose.pendingActivatesAt.toNumber()).to.be.gte(proposeNow + SEVEN_DAYS_SECS - 2);

    let preTimelockErr: unknown;
    try {
      await program.methods.executeVkActivation().accountsPartial({ vk: nextVkPda }).rpc();
    } catch (e) {
      preTimelockErr = e;
    }
    expect(String(preTimelockErr)).to.match(/TimelockNotElapsed/);

    await warpClockBy(env.context, SEVEN_DAYS_SECS + 1);
    await program.methods.executeVkActivation().accountsPartial({ vk: nextVkPda }).rpc();

    const activated = await program.account.verifierConfig.fetch(cfgPda);
    expect(activated.activeVk.toBase58()).to.equal(nextVkPda.toBase58());
    expect(activated.pendingVk).to.equal(null);
    expect(activated.pendingActivatesAt.toNumber()).to.equal(0);
  });

  it('cancel during a timed rotation clears pending_vk without activating', async () => {
    const currentVkId = computeVkId(CIRCUIT_LABEL);
    const nextVkId = computeVkId(ROTATION_LABEL);
    const [currentVkPda] = proofVerifier.vk(currentVkId);
    const [nextVkPda] = proofVerifier.vk(nextVkId);
    const [cfgPda] = proofVerifier.config();
    const [modePda] = proofVerifier.mode();

    await program.methods.initConfig(authority, false).accountsPartial({ payer: authority }).rpc();
    await registerDevVk(program, authority, currentVkId);
    await registerDevVk(program, authority, nextVkId, ROTATION_LABEL);

    await program.methods
      .proposeVkActivation()
      .accountsPartial({ vk: currentVkPda, mode: modePda, authority })
      .rpc();
    await program.methods.executeVkActivation().accountsPartial({ vk: currentVkPda }).rpc();

    await program.methods
      .proposeVkActivation()
      .accountsPartial({ vk: nextVkPda, mode: modePda, authority })
      .rpc();

    const cancelBuilder = program.methods.cancelVkActivation().accountsPartial({ authority });
    {
      const cu = await measureCU(env.context, cancelBuilder, env.context.payer);
      logCU('cancel_vk_activation', cu);
      assertWithinBudget('cancel_vk_activation', cu, CU_BUDGETS.cancel_vk_activation);
    }
    await cancelBuilder.rpc();

    const cancelled = await program.account.verifierConfig.fetch(cfgPda);
    expect(cancelled.pendingVk).to.equal(null);
    expect(cancelled.pendingActivatesAt.toNumber()).to.equal(0);

    await warpClockBy(env.context, SEVEN_DAYS_SECS + 1);
    let noPendingErr: unknown;
    try {
      await program.methods.executeVkActivation().accountsPartial({ vk: nextVkPda }).rpc();
    } catch (e) {
      noPendingErr = e;
    }
    expect(String(noPendingErr)).to.match(/NoPendingActivation/);
  });
});
