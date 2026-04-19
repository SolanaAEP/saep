import { describe, it, expect } from 'vitest';
import { PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js';
import idl from '../../idl/proof_verifier.json' with { type: 'json' };
import type { ProofVerifier } from '../../generated/proof_verifier.js';
import {
  proofVerifierAllowedCallersPda,
  proofVerifierGuardPda,
  verifierConfigPda,
  verifierKeyPda,
  verifierModePda,
} from '../../pda/index.js';
import {
  buildRegisterVkIx,
  buildProposeVkActivationIx,
  buildExecuteVkActivationIx,
  buildVerifyProofIx,
} from '../proof_verifier.js';
import { makeTestProgram, decodeIx, expectedDiscriminator, accountKeys } from './helpers.js';

const PROG = new PublicKey('DcJx1p6bcNuFm4i5WMgK4uGZitc1bf4Ubc5d4sctZKVe');

const program = makeTestProgram<ProofVerifier>(idl as Record<string, unknown>, PROG);

const authority = PublicKey.unique();
const payer = PublicKey.unique();
const vkId = new Uint8Array(32).fill(0x01);
const alphaG1 = new Uint8Array(64).fill(0x11);
const betaG2 = new Uint8Array(128).fill(0x22);
const gammaG2 = new Uint8Array(128).fill(0x33);
const deltaG2 = new Uint8Array(128).fill(0x44);
const ic = [new Uint8Array(64).fill(0x55), new Uint8Array(64).fill(0x66)];
const circuitLabel = new Uint8Array(32).fill(0x77);

describe('buildRegisterVkIx', () => {
  it('returns ix with correct programId, discriminator, accounts', async () => {
    const ix = await buildRegisterVkIx(program, {
      authority,
      payer,
      vkId,
      alphaG1,
      betaG2,
      gammaG2,
      deltaG2,
      ic,
      numPublicInputs: 4,
      circuitLabel,
      isProduction: true,
    });
    expect(ix.programId.equals(PROG)).toBe(true);
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'register_vk'));
    const [config] = verifierConfigPda(PROG);
    const [vk] = verifierKeyPda(PROG, vkId);
    expect(accountKeys(ix)).toEqual([
      config.toBase58(),
      vk.toBase58(),
      authority.toBase58(),
      payer.toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
    expect(ix.keys[2].isSigner).toBe(true);
    expect(ix.keys[3].isSigner).toBe(true);
    expect(ix.keys[3].isWritable).toBe(true);
  });

  it('round-trips args via BorshInstructionCoder', async () => {
    const ix = await buildRegisterVkIx(program, {
      authority,
      payer,
      vkId,
      alphaG1,
      betaG2,
      gammaG2,
      deltaG2,
      ic,
      numPublicInputs: 2,
      circuitLabel,
      isProduction: false,
    });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('register_vk');
    const data = decoded.data as Record<string, unknown>;
    expect(data.vk_id).toEqual(Array.from(vkId));
    expect(data.alpha_g1).toEqual(Array.from(alphaG1));
    expect(data.ic).toEqual(ic.map((x) => Array.from(x)));
    expect(data.num_public_inputs).toBe(2);
    expect(data.is_production).toBe(false);
  });

  it('encodes is_production = true', async () => {
    const ix = await buildRegisterVkIx(program, {
      authority,
      payer,
      vkId,
      alphaG1,
      betaG2,
      gammaG2,
      deltaG2,
      ic,
      numPublicInputs: 1,
      circuitLabel,
      isProduction: true,
    });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect((decoded.data as { is_production: boolean }).is_production).toBe(true);
  });
});

describe('buildProposeVkActivationIx', () => {
  const vk = PublicKey.unique();

  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildProposeVkActivationIx(program, { authority, vk });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'propose_vk_activation'));
    const [config] = verifierConfigPda(PROG);
    const [mode] = verifierModePda(PROG);
    expect(accountKeys(ix)).toEqual([
      config.toBase58(),
      vk.toBase58(),
      mode.toBase58(),
      authority.toBase58(),
    ]);
    expect(ix.keys[3].isSigner).toBe(true);
  });
});

describe('buildExecuteVkActivationIx', () => {
  const vk = PublicKey.unique();

  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildExecuteVkActivationIx(program, { vk });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'execute_vk_activation'));
    const [config] = verifierConfigPda(PROG);
    expect(accountKeys(ix)).toEqual([config.toBase58(), vk.toBase58()]);
  });
});

describe('buildVerifyProofIx', () => {
  const vk = PublicKey.unique();
  const callerGuard = PublicKey.unique();
  const proofA = new Uint8Array(64).fill(0xaa);
  const proofB = new Uint8Array(128).fill(0xbb);
  const proofC = new Uint8Array(64).fill(0xcc);
  const publicInputs = [
    new Uint8Array(32).fill(0x01),
    new Uint8Array(32).fill(0x02),
  ];

  it('returns ix with all 7 F-2026-04 accounts in IDL order', async () => {
    const ix = await buildVerifyProofIx(program, {
      vk,
      proofA,
      proofB,
      proofC,
      publicInputs,
      callerGuard,
    });
    expect(ix.programId.equals(PROG)).toBe(true);
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(
      expectedDiscriminator(idl as never, 'verify_proof'),
    );
    const [config] = verifierConfigPda(PROG);
    const [mode] = verifierModePda(PROG);
    const [selfGuard] = proofVerifierGuardPda(PROG);
    const [allowedCallers] = proofVerifierAllowedCallersPda(PROG);
    expect(accountKeys(ix)).toEqual([
      config.toBase58(),
      vk.toBase58(),
      mode.toBase58(),
      selfGuard.toBase58(),
      allowedCallers.toBase58(),
      callerGuard.toBase58(),
      SYSVAR_INSTRUCTIONS_PUBKEY.toBase58(),
    ]);
    expect(ix.keys.every((k) => !k.isSigner)).toBe(true);
    expect(ix.keys.every((k) => !k.isWritable)).toBe(true);
  });

  it('round-trips proof + public_inputs via BorshInstructionCoder', async () => {
    const ix = await buildVerifyProofIx(program, {
      vk,
      proofA,
      proofB,
      proofC,
      publicInputs,
      callerGuard,
    });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('verify_proof');
    const data = decoded.data as Record<string, unknown>;
    expect(data.proof_a).toEqual(Array.from(proofA));
    expect(data.proof_b).toEqual(Array.from(proofB));
    expect(data.proof_c).toEqual(Array.from(proofC));
    expect(data.public_inputs).toEqual(publicInputs.map((x) => Array.from(x)));
  });
});
