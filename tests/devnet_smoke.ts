import * as anchor from '@coral-xyz/anchor';
import { Keypair, PublicKey } from '@solana/web3.js';
import { expect } from 'chai';

import type { ProofVerifier } from '../target/types/proof_verifier';
import { computeVkId, registerDevVk, DEFAULT_CIRCUIT_LABEL } from './helpers/vk';

const PROOF_VERIFIER_ID = new PublicKey('DcJx1p6bcNuFm4i5WMgK4uGZitc1bf4Ubc5d4sctZKVe');

describe('devnet smoke — chunked VK registration', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const proofVerifier = anchor.workspace.proofVerifier as anchor.Program<ProofVerifier>;

  it('connects to devnet', async () => {
    const version = await provider.connection.getVersion();
    expect(version).to.have.property('solana-core');
    const slot = await provider.connection.getSlot();
    console.log(`  devnet slot: ${slot}`);
  });

  it('proof_verifier program is deployed', async () => {
    const info = await provider.connection.getAccountInfo(PROOF_VERIFIER_ID);
    expect(info).to.not.be.null;
    expect(info!.executable).to.be.true;
  });

  it('init_config + chunked VK registration (init_vk + append_vk_ic)', async () => {
    const authority = provider.wallet.publicKey;

    // init_config — may already exist from prior runs
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('verifier_config')],
      proofVerifier.programId,
    );
    const configInfo = await provider.connection.getAccountInfo(configPda);
    if (!configInfo) {
      await proofVerifier.methods
        .initConfig(authority, false)
        .accountsPartial({ authority, payer: authority })
        .rpc();
      console.log('  init_config: created');
    } else {
      console.log('  init_config: already exists');
    }

    // Register VK via chunked path with unique label to avoid collision
    const label = `smoke_${Date.now().toString(36)}`;
    const vkId = computeVkId(label);
    await registerDevVk(proofVerifier, authority, vkId, label);

    // Verify VK account exists and is finalized
    const [vkPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vk'), vkId],
      proofVerifier.programId,
    );
    const vkAccount = await proofVerifier.account.verifierKey.fetch(vkPda);
    expect(vkAccount.registeredAt.toNumber()).to.be.greaterThan(0);
    expect(Buffer.from(vkAccount.vkId)).to.deep.equal(vkId);
    console.log(`  VK registered: ${vkPda.toBase58()} (label: ${label})`);
  });
});
