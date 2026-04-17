import { BN, Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import type { CapabilityRegistry } from '../generated/capability_registry.js';
import { capabilityConfigPda } from '../pda/index.js';

export interface ProposeTagInput {
  authority: PublicKey;
  payer: PublicKey;
  tag: PublicKey;
  bitIndex: number;
  slug: Uint8Array;
  manifestUri: Uint8Array;
}

export async function buildProposeTagIx(
  program: Program<CapabilityRegistry>,
  input: ProposeTagInput,
): Promise<TransactionInstruction> {
  const [config] = capabilityConfigPda(program.programId);

  return program.methods
    .proposeTag(
      input.bitIndex,
      Array.from(input.slug),
      Array.from(input.manifestUri),
    )
    .accounts({
      config,
      tag: input.tag,
      authority: input.authority,
      payer: input.payer,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface RetireTagInput {
  authority: PublicKey;
  tag: PublicKey;
  bitIndex: number;
}

export async function buildRetireTagIx(
  program: Program<CapabilityRegistry>,
  input: RetireTagInput,
): Promise<TransactionInstruction> {
  const [config] = capabilityConfigPda(program.programId);

  return program.methods
    .retireTag(input.bitIndex)
    .accounts({
      config,
      tag: input.tag,
      authority: input.authority,
    } as never)
    .instruction();
}

export interface ValidateMaskInput {
  mask: bigint;
}

export async function buildValidateMaskIx(
  program: Program<CapabilityRegistry>,
  input: ValidateMaskInput,
): Promise<TransactionInstruction> {
  const [config] = capabilityConfigPda(program.programId);

  return program.methods
    .validateMask(new BN(input.mask.toString()))
    .accounts({
      config,
    } as never)
    .instruction();
}
