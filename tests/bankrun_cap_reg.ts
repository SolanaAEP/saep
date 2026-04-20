import * as anchor from '@coral-xyz/anchor';
import { expect } from 'chai';

import { capReg, PROGRAM_IDS } from './helpers/accounts';
import { padBytes } from './helpers/encoding';
import { startBankrun, loadBankrunProgram, BankrunEnv } from './helpers/bankrun';
import {
  measureCU, logCU, assertWithinBudget, CU_BUDGETS, printCUSummary, resetCUMeasurements,
} from './helpers/cu';
import type { CapabilityRegistry } from '../target/types/capability_registry';

type Program = anchor.Program<CapabilityRegistry>;

const slug = (s: string) => padBytes(s, 32) as unknown as number[];
const uri = (s: string) => padBytes(s, 96) as unknown as number[];

async function expectError(fn: () => Promise<unknown>, code: string | RegExp): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const msg = String(e);
    const match = typeof code === 'string' ? msg.includes(code) : code.test(msg);
    if (!match) throw new Error(`expected error matching ${code}, got: ${msg}`);
    return;
  }
  throw new Error(`expected throw matching ${code}, but call resolved`);
}

describe('bankrun: capability_registry — retire_tag + validate_mask CU coverage', () => {
  let env: BankrunEnv;
  let program: Program;
  let authority: anchor.web3.PublicKey;
  const [configPda] = capReg.config();

  const BIT_A = 3;
  const BIT_B = 17;

  before(function () { resetCUMeasurements(); });
  after(function () { printCUSummary(); });

  beforeEach(async () => {
    env = await startBankrun();
    program = loadBankrunProgram<CapabilityRegistry>('capability_registry', env.provider);
    authority = env.wallet.publicKey;
  });

  it('program id matches Anchor.toml', () => {
    expect(program.programId.toBase58()).to.equal(PROGRAM_IDS.capability_registry.toBase58());
  });

  it('initialize → propose_tag → validate_mask approved → validate_mask unapproved rejects', async () => {
    const initBuilder = program.methods
      .initialize(authority)
      .accountsPartial({ payer: authority });
    const initCU = await measureCU(env.context, initBuilder, env.context.payer);
    logCU('initialize', initCU);
    assertWithinBudget('initialize', initCU, CU_BUDGETS.initialize!);
    await initBuilder.rpc();

    const cfg0 = await program.account.registryConfig.fetch(configPda);
    expect(cfg0.authority.toBase58()).to.equal(authority.toBase58());
    expect(cfg0.paused).to.equal(false);
    expect(cfg0.tagCount).to.equal(0);

    const [tagPda] = capReg.tag(BIT_A);
    const proposeBuilder = program.methods
      .proposeTag(BIT_A, slug('cap_a'), uri('ipfs://cap-a'))
      .accountsPartial({ tag: tagPda, authority, payer: authority });
    const proposeCU = await measureCU(env.context, proposeBuilder, env.context.payer);
    logCU('propose_tag', proposeCU);
    assertWithinBudget('propose_tag', proposeCU, CU_BUDGETS.propose_tag!);
    await proposeBuilder.rpc();

    const cfg1 = await program.account.registryConfig.fetch(configPda);
    expect(cfg1.tagCount).to.equal(1);
    expect(cfg1.approvedMask.testn(BIT_A)).to.equal(true);

    const validateBuilder = program.methods
      .validateMask(new anchor.BN(1).shln(BIT_A))
      .accountsPartial({});
    const validateCU = await measureCU(env.context, validateBuilder, env.context.payer);
    logCU('validate_mask', validateCU);
    assertWithinBudget('validate_mask', validateCU, CU_BUDGETS.validate_mask!);
    await validateBuilder.rpc();

    await expectError(
      () =>
        program.methods
          .validateMask(new anchor.BN(1).shln(99))
          .accountsPartial({})
          .rpc(),
      /InvalidCapability|capability/,
    );
  });

  it('update_manifest_uri + set_tag_personhood mutate tag fields', async () => {
    await program.methods
      .initialize(authority)
      .accountsPartial({ payer: authority })
      .rpc();

    const [tagPda] = capReg.tag(BIT_A);
    await program.methods
      .proposeTag(BIT_A, slug('cap_a'), uri('ipfs://cap-a'))
      .accountsPartial({ tag: tagPda, authority, payer: authority })
      .rpc();

    const updateBuilder = program.methods
      .updateManifestUri(BIT_A, uri('ipfs://cap-a-v2'))
      .accountsPartial({ tag: tagPda, authority });
    const updateCU = await measureCU(env.context, updateBuilder, env.context.payer);
    logCU('update_manifest_uri', updateCU);
    assertWithinBudget('update_manifest_uri', updateCU, CU_BUDGETS.update_manifest_uri!);
    await updateBuilder.rpc();

    const personhoodBuilder = program.methods
      .setTagPersonhood(BIT_A, 2)
      .accountsPartial({ tag: tagPda, authority });
    const personhoodCU = await measureCU(env.context, personhoodBuilder, env.context.payer);
    logCU('set_tag_personhood', personhoodCU);
    assertWithinBudget('set_tag_personhood', personhoodCU, CU_BUDGETS.set_tag_personhood!);
    await personhoodBuilder.rpc();

    const tag = await program.account.capabilityTag.fetch(tagPda);
    expect(tag.minPersonhoodTier).to.equal(2);
    expect(Buffer.from(tag.manifestUri).toString('utf8').replace(/\0+$/, '')).to.equal(
      'ipfs://cap-a-v2',
    );
  });

  it('set_paused(true) blocks propose_tag + retire_tag; set_paused(false) restores', async () => {
    await program.methods
      .initialize(authority)
      .accountsPartial({ payer: authority })
      .rpc();

    const [tagPda] = capReg.tag(BIT_A);
    await program.methods
      .proposeTag(BIT_A, slug('cap_a'), uri('ipfs://cap-a'))
      .accountsPartial({ tag: tagPda, authority, payer: authority })
      .rpc();

    const pauseBuilder = program.methods.setPaused(true).accountsPartial({ authority });
    const pauseCU = await measureCU(env.context, pauseBuilder, env.context.payer);
    logCU('set_paused', pauseCU);
    assertWithinBudget('set_paused', pauseCU, CU_BUDGETS.set_paused!);
    await pauseBuilder.rpc();
    expect((await program.account.registryConfig.fetch(configPda)).paused).to.equal(true);

    await expectError(
      () =>
        program.methods
          .retireTag(BIT_A)
          .accountsPartial({ tag: tagPda, authority })
          .rpc(),
      /Paused|paused/,
    );

    await program.methods.setPaused(false).accountsPartial({ authority }).rpc();
    expect((await program.account.registryConfig.fetch(configPda)).paused).to.equal(false);
  });

  it('retire_tag clears bit + marks retired; validate_mask rejects retired bit', async () => {
    await program.methods
      .initialize(authority)
      .accountsPartial({ payer: authority })
      .rpc();

    const [tagA] = capReg.tag(BIT_A);
    const [tagB] = capReg.tag(BIT_B);
    await program.methods
      .proposeTag(BIT_A, slug('cap_a'), uri('ipfs://cap-a'))
      .accountsPartial({ tag: tagA, authority, payer: authority })
      .rpc();
    await program.methods
      .proposeTag(BIT_B, slug('cap_b'), uri('ipfs://cap-b'))
      .accountsPartial({ tag: tagB, authority, payer: authority })
      .rpc();

    const mixed = new anchor.BN(1).shln(BIT_A).or(new anchor.BN(1).shln(BIT_B));
    await program.methods.validateMask(mixed).accountsPartial({}).rpc();

    const retireBuilder = program.methods
      .retireTag(BIT_A)
      .accountsPartial({ tag: tagA, authority });
    const retireCU = await measureCU(env.context, retireBuilder, env.context.payer);
    logCU('retire_tag', retireCU);
    assertWithinBudget('retire_tag', retireCU, CU_BUDGETS.retire_tag!);
    await retireBuilder.rpc();

    const cfg = await program.account.registryConfig.fetch(configPda);
    expect(cfg.approvedMask.testn(BIT_A)).to.equal(false);
    expect(cfg.approvedMask.testn(BIT_B)).to.equal(true);
    const tag = await program.account.capabilityTag.fetch(tagA);
    expect(tag.retired).to.equal(true);

    await program.methods
      .validateMask(new anchor.BN(1).shln(BIT_B))
      .accountsPartial({})
      .rpc();

    await expectError(
      () =>
        program.methods
          .validateMask(new anchor.BN(1).shln(BIT_A))
          .accountsPartial({})
          .rpc(),
      /InvalidCapability|capability/,
    );
  });
});
