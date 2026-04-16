import { BN, Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import type { ProofVerifier } from '../generated/proof_verifier.js';
import { verifierConfigPda, verifierKeyPda, verifierModePda } from '../pda/index.js';

export interface RegisterVkInput {
  authority: PublicKey;
  payer: PublicKey;
  vkId: Uint8Array;
  alphaG1: Uint8Array;
  betaG2: Uint8Array;
  gammaG2: Uint8Array;
  deltaG2: Uint8Array;
  ic: Uint8Array[];
  numPublicInputs: number;
  circuitLabel: Uint8Array;
  isProduction: boolean;
}

export async function buildRegisterVkIx(
  program: Program<ProofVerifier>,
  input: RegisterVkInput,
): Promise<TransactionInstruction> {
  const [config] = verifierConfigPda(program.programId);
  const [vk] = verifierKeyPda(program.programId, input.vkId);

  return program.methods
    .registerVk(
      Array.from(input.vkId) as unknown as number[],
      Array.from(input.alphaG1) as unknown as number[],
      Array.from(input.betaG2) as unknown as number[],
      Array.from(input.gammaG2) as unknown as number[],
      Array.from(input.deltaG2) as unknown as number[],
      input.ic.map((x) => Array.from(x) as unknown as number[]),
      input.numPublicInputs,
      Array.from(input.circuitLabel) as unknown as number[],
      input.isProduction,
    )
    .accounts({
      config,
      vk,
      authority: input.authority,
      payer: input.payer,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface ProposeVkActivationInput {
  authority: PublicKey;
  vk: PublicKey;
}

export async function buildProposeVkActivationIx(
  program: Program<ProofVerifier>,
  input: ProposeVkActivationInput,
): Promise<TransactionInstruction> {
  const [config] = verifierConfigPda(program.programId);
  const [mode] = verifierModePda(program.programId);

  return program.methods
    .proposeVkActivation()
    .accounts({
      config,
      vk: input.vk,
      mode,
      authority: input.authority,
    } as never)
    .instruction();
}

export interface ExecuteVkActivationInput {
  vk: PublicKey;
}

export async function buildExecuteVkActivationIx(
  program: Program<ProofVerifier>,
  input: ExecuteVkActivationInput,
): Promise<TransactionInstruction> {
  const [config] = verifierConfigPda(program.programId);

  return program.methods
    .executeVkActivation()
    .accounts({
      config,
      vk: input.vk,
    } as never)
    .instruction();
}

export interface VerifyProofInput {
  vk: PublicKey;
  proofA: Uint8Array;
  proofB: Uint8Array;
  proofC: Uint8Array;
  publicInputs: Uint8Array[];
}

export async function buildVerifyProofIx(
  program: Program<ProofVerifier>,
  input: VerifyProofInput,
): Promise<TransactionInstruction> {
  const [config] = verifierConfigPda(program.programId);
  const [mode] = verifierModePda(program.programId);

  return program.methods
    .verifyProof(
      Array.from(input.proofA) as unknown as number[],
      Array.from(input.proofB) as unknown as number[],
      Array.from(input.proofC) as unknown as number[],
      input.publicInputs.map((x) => Array.from(x) as unknown as number[]),
    )
    .accounts({
      config,
      vk: input.vk,
      mode,
    } as never)
    .instruction();
}
