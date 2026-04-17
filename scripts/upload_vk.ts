import * as anchor from '@coral-xyz/anchor';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PublicKey } from '@solana/web3.js';
import type { ProofVerifier } from '../target/types/proof_verifier';

const PROGRAM_ID = new PublicKey('DcJx1p6bcNuFm4i5WMgK4uGZitc1bf4Ubc5d4sctZKVe');
const CIRCUIT_LABEL = 'task_completion_v1';

function configPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('verifier_config')], PROGRAM_ID);
}

function modePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('mode')], PROGRAM_ID);
}

function vkPda(vkId: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vk'), Buffer.from(vkId)],
    PROGRAM_ID,
  );
}

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
  const x = fieldElementToBytes(point[0]);
  const y = fieldElementToBytes(point[1]);
  return [...x, ...y];
}

function g2ToBytes(point: [[string, string], [string, string], [string, string]]): number[] {
  // snarkjs stores Fp2 as [real, imaginary]
  // Ethereum precompile expects [imaginary, real] per coordinate
  const x_im = fieldElementToBytes(point[0][1]);
  const x_re = fieldElementToBytes(point[0][0]);
  const y_im = fieldElementToBytes(point[1][1]);
  const y_re = fieldElementToBytes(point[1][0]);
  return [...x_im, ...x_re, ...y_im, ...y_re];
}

function padLabel(s: string): number[] {
  const buf = Buffer.alloc(32, 0);
  Buffer.from(s, 'utf8').copy(buf);
  return Array.from(buf);
}

function computeVkId(label: string): Buffer {
  return createHash('sha256').update(label).digest();
}

interface SnarkjsVK {
  nPublic: number;
  vk_alpha_1: [string, string, string];
  vk_beta_2: [[string, string], [string, string], [string, string]];
  vk_gamma_2: [[string, string], [string, string], [string, string]];
  vk_delta_2: [[string, string], [string, string], [string, string]];
  IC: [string, string, string][];
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const idl = require('../target/idl/proof_verifier.json');
  const program = new anchor.Program<ProofVerifier>(idl, provider);
  const authority = provider.wallet;

  const vkPath = resolve(__dirname, '../circuits/task_completion/build/verification_key.json');
  const vkJson: SnarkjsVK = JSON.parse(readFileSync(vkPath, 'utf-8'));

  const vkId = computeVkId(CIRCUIT_LABEL);
  const circuitLabel = padLabel(CIRCUIT_LABEL);
  const alphaG1 = g1ToBytes(vkJson.vk_alpha_1);
  const betaG2 = g2ToBytes(vkJson.vk_beta_2);
  const gammaG2 = g2ToBytes(vkJson.vk_gamma_2);
  const deltaG2 = g2ToBytes(vkJson.vk_delta_2);
  const ic = vkJson.IC.map((p) => g1ToBytes(p));
  const numPublicInputs = vkJson.nPublic;

  console.log(`circuit: ${CIRCUIT_LABEL}`);
  console.log(`vk_id: ${vkId.toString('hex')}`);
  console.log(`public inputs: ${numPublicInputs}`);
  console.log(`IC points: ${ic.length} (expected ${numPublicInputs + 1})`);

  const [configPubkey] = configPda();
  let cfg = await program.account.verifierConfig.fetch(configPubkey).catch(() => null);
  if (!cfg) {
    console.log('initializing verifier config (is_mainnet=false)...');
    await program.methods
      .initConfig(authority.publicKey, false)
      .accountsPartial({ payer: authority.publicKey })
      .rpc({ commitment: 'confirmed' });
    cfg = await program.account.verifierConfig.fetch(configPubkey);
  }

  const [vkPubkey] = vkPda(vkId);
  const existing = await program.account.verifierKey.fetch(vkPubkey).catch(() => null);

  if (existing && existing.registeredAt.toNumber() > 0) {
    console.log(`VK already finalized at ${vkPubkey.toBase58()}, skipping.`);
  } else {
    if (!existing) {
      console.log('init_vk (header)...');
      await program.methods
        .initVk(
          Array.from(vkId) as unknown as number[],
          alphaG1 as unknown as number[],
          betaG2 as unknown as number[],
          gammaG2 as unknown as number[],
          deltaG2 as unknown as number[],
          numPublicInputs,
          circuitLabel as unknown as number[],
          false, // is_production = false (dev ceremony)
        )
        .accountsPartial({
          authority: authority.publicKey,
          payer: authority.publicKey,
        })
        .rpc({ commitment: 'confirmed' });
    } else {
      console.log(`resuming append from existing ic.length=${existing.ic.length}`);
    }

    const startIdx = existing ? existing.ic.length : 0;
    const remaining = ic.slice(startIdx);
    console.log(`append_vk_ic (${remaining.length} points, finalize=true)...`);
    await program.methods
      .appendVkIc(remaining as unknown as number[][], true)
      .accountsPartial({ authority: authority.publicKey, vk: vkPubkey })
      .rpc({ commitment: 'confirmed' });
    console.log(`VK registered at ${vkPubkey.toBase58()}`);
  }

  const vkAccount = await program.account.verifierKey.fetch(vkPubkey);
  console.log(`\non-chain VK state:`);
  console.log(`  vk_id: ${Buffer.from(vkAccount.vkId).toString('hex')}`);
  console.log(`  num_public_inputs: ${vkAccount.numPublicInputs}`);
  console.log(`  is_production: ${vkAccount.isProduction}`);
  console.log(`  circuit_label: ${Buffer.from(vkAccount.circuitLabel).toString('utf-8').replace(/\0+$/, '')}`);
  console.log(`  IC length: ${vkAccount.ic.length}`);
  console.log(`  registered_by: ${vkAccount.registeredBy.toBase58()}`);

  if (cfg!.activeVk.equals(PublicKey.default)) {
    console.log('\nproposing VK activation (7-day timelock)...');
    const [modePubkey] = modePda();
    await program.methods
      .proposeVkActivation()
      .accountsPartial({
        vk: vkPubkey,
        mode: modePubkey,
        authority: authority.publicKey,
      })
      .rpc({ commitment: 'confirmed' });

    const updatedCfg = await program.account.verifierConfig.fetch(configPubkey);
    console.log(`pending_vk: ${updatedCfg.pendingVk?.toBase58()}`);
    console.log(`activates_at: ${new Date(updatedCfg.pendingActivatesAt.toNumber() * 1000).toISOString()}`);
  } else {
    console.log(`\nactive_vk already set: ${cfg!.activeVk.toBase58()}`);
    if (!cfg!.activeVk.equals(vkPubkey)) {
      console.log('WARNING: active VK differs from the one just registered.');
      console.log('To rotate, propose activation manually.');
    }
  }

  console.log('\ndone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
