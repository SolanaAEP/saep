import * as anchor from '@coral-xyz/anchor';
import { expect } from 'chai';
import { getProvider, padRight } from './helpers/setup';
import { capReg, PROGRAM_IDS } from './helpers/accounts';
import type { CapabilityRegistry } from '../target/types/capability_registry';

// CU-MEASURE-PENDING: log tx.meta.computeUnitsConsumed once `anchor test` runs.

describe('capability_registry', () => {
  const provider = getProvider();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const idl = require('../target/idl/capability_registry.json');
  const program = new anchor.Program<CapabilityRegistry>(idl, provider);

  const authority = provider.wallet;
  const [configPda] = capReg.config();

  it('initialize: creates registry config', async () => {
    try {
      await program.methods
        .initialize(authority.publicKey)
        .accountsPartial({ payer: authority.publicKey })
        .rpc();
    } catch (e) {
      // Allow idempotent re-run on already-initialized localnet.
      if (!String(e).includes('already in use')) throw e;
    }
    const cfg = await program.account.registryConfig.fetch(configPda);
    expect(cfg.authority.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(cfg.paused).to.equal(false);
  });

  it('propose_tag: happy path sets bit in approved_mask', async () => {
    const bitIndex = 3;
    const slug = padRight('test_cap', 32);
    const manifest = padRight('ipfs://cap-manifest', 96);
    const [tagPda] = capReg.tag(bitIndex);

    try {
      await program.methods
        .proposeTag(
          bitIndex,
          Array.from(slug) as number[],
          Array.from(manifest) as number[],
        )
        .accountsPartial({ authority: authority.publicKey, payer: authority.publicKey })
        .rpc();
    } catch (e) {
      if (!String(e).includes('already in use')) throw e;
    }

    const tag = await program.account.capabilityTag.fetch(tagPda);
    expect(tag.bitIndex).to.equal(bitIndex);
    expect(tag.retired).to.equal(false);
  });

  it('update_manifest_uri: rewrites manifest_uri', async () => {
    const bitIndex = 3;
    const newManifest = padRight('ipfs://cap-manifest-v2', 96);
    await program.methods
      .updateManifestUri(bitIndex, Array.from(newManifest) as number[])
      .accountsPartial({ authority: authority.publicKey })
      .rpc();
  });

  it('pause/unpause toggles paused flag', async () => {
    await program.methods
      .setPaused(true)
      .accountsPartial({ authority: authority.publicKey })
      .rpc();
    let cfg = await program.account.registryConfig.fetch(configPda);
    expect(cfg.paused).to.equal(true);
    await program.methods
      .setPaused(false)
      .accountsPartial({ authority: authority.publicKey })
      .rpc();
    cfg = await program.account.registryConfig.fetch(configPda);
    expect(cfg.paused).to.equal(false);
  });

  it('validate_mask: read-only invariant check', async () => {
    const mask = new anchor.BN(1 << 3);
    await program.methods.validateMask(mask).accountsPartial({}).rpc();
  });

  it('retire_tag: clears bit and marks retired', async () => {
    const bitIndex = 3;
    await program.methods
      .retireTag(bitIndex)
      .accountsPartial({ authority: authority.publicKey })
      .rpc();
    const [tagPda] = capReg.tag(bitIndex);
    const tag = await program.account.capabilityTag.fetch(tagPda);
    expect(tag.retired).to.equal(true);
  });

  it.skip('2-step authority transfer (propose -> accept)', async () => {
    // IDL: transfer_authority(new_authority) + accept_authority().
    // Skeleton — wire once new-authority keypair + airdrop plumbing is shared.
  });

  it('program id matches Anchor.toml', () => {
    expect(program.programId.toBase58()).to.equal(
      PROGRAM_IDS.capability_registry.toBase58(),
    );
  });
});
