import { BN, Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import type { TemplateRegistry } from '../generated/template_registry.js';
import {
  templateGlobalPda,
  templatePda,
  rentalPda,
  rentalEscrowPda,
  forkPda,
} from '../pda/index.js';

export interface MintTemplateInput {
  author: PublicKey;
  templateId: Uint8Array;
  configHash: Uint8Array;
  configUri: Uint8Array;
  capabilityMask: bigint;
  royaltyBps: number;
  rentPricePerSec: bigint;
  minRentDuration: bigint;
  maxRentDuration: bigint;
}

export async function buildMintTemplateIx(
  program: Program<TemplateRegistry>,
  input: MintTemplateInput,
): Promise<TransactionInstruction> {
  const [global] = templateGlobalPda(program.programId);
  const [template] = templatePda(program.programId, input.templateId);

  return program.methods
    .mintTemplate(
      Array.from(input.templateId) as never,
      Array.from(input.configHash) as never,
      Array.from(input.configUri) as never,
      new BN(input.capabilityMask.toString()),
      input.royaltyBps,
      new BN(input.rentPricePerSec.toString()),
      new BN(input.minRentDuration.toString()),
      new BN(input.maxRentDuration.toString()),
    )
    .accounts({
      global,
      template,
      author: input.author,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface UpdateTemplateInput {
  author: PublicKey;
  templateId: Uint8Array;
  configHash: Uint8Array;
  configUri: Uint8Array;
}

export async function buildUpdateTemplateIx(
  program: Program<TemplateRegistry>,
  input: UpdateTemplateInput,
): Promise<TransactionInstruction> {
  const [global] = templateGlobalPda(program.programId);
  const [template] = templatePda(program.programId, input.templateId);

  return program.methods
    .updateTemplate(
      Array.from(input.configHash) as never,
      Array.from(input.configUri) as never,
    )
    .accounts({
      global,
      template,
      author: input.author,
    } as never)
    .instruction();
}

export interface RetireTemplateInput {
  signer: PublicKey;
  templateId: Uint8Array;
}

export async function buildRetireTemplateIx(
  program: Program<TemplateRegistry>,
  input: RetireTemplateInput,
): Promise<TransactionInstruction> {
  const [global] = templateGlobalPda(program.programId);
  const [template] = templatePda(program.programId, input.templateId);

  return program.methods
    .retireTemplate()
    .accounts({
      global,
      template,
      signer: input.signer,
    } as never)
    .instruction();
}

export interface ForkTemplateInput {
  forker: PublicKey;
  parentTemplateId: Uint8Array;
  childAgentDid: Uint8Array;
}

export async function buildForkTemplateIx(
  program: Program<TemplateRegistry>,
  input: ForkTemplateInput,
): Promise<TransactionInstruction> {
  const [global] = templateGlobalPda(program.programId);
  const [parent] = templatePda(program.programId, input.parentTemplateId);
  const [fork] = forkPda(program.programId, input.childAgentDid);

  return program.methods
    .forkTemplate(Array.from(input.childAgentDid) as never)
    .accounts({
      global,
      parent,
      fork,
      forker: input.forker,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface OpenRentalInput {
  renter: PublicKey;
  templateId: Uint8Array;
  mint: PublicKey;
  renterTokenAccount: PublicKey;
  durationSecs: bigint;
  rentalNonce: Uint8Array;
  tokenProgram: PublicKey;
}

export async function buildOpenRentalIx(
  program: Program<TemplateRegistry>,
  input: OpenRentalInput,
): Promise<TransactionInstruction> {
  const [global] = templateGlobalPda(program.programId);
  const [template] = templatePda(program.programId, input.templateId);
  const [rental] = rentalPda(program.programId, template, input.renter, input.rentalNonce);
  const [escrow] = rentalEscrowPda(program.programId, rental);

  return program.methods
    .openRental(
      new BN(input.durationSecs.toString()),
      Array.from(input.rentalNonce) as never,
    )
    .accounts({
      global,
      template,
      rental,
      mint: input.mint,
      escrow,
      renterTokenAccount: input.renterTokenAccount,
      renter: input.renter,
      tokenProgram: input.tokenProgram,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface CloseRentalInput {
  signer: PublicKey;
  rental: PublicKey;
  templateId: Uint8Array;
  mint: PublicKey;
  authorTokenAccount: PublicKey;
  feeCollectorTokenAccount: PublicKey;
  renterTokenAccount: PublicKey;
  tokenProgram: PublicKey;
}

export async function buildCloseRentalIx(
  program: Program<TemplateRegistry>,
  input: CloseRentalInput,
): Promise<TransactionInstruction> {
  const [global] = templateGlobalPda(program.programId);
  const [template] = templatePda(program.programId, input.templateId);
  const [escrow] = rentalEscrowPda(program.programId, input.rental);

  return program.methods
    .closeRental()
    .accounts({
      global,
      template,
      rental: input.rental,
      mint: input.mint,
      escrow,
      authorTokenAccount: input.authorTokenAccount,
      feeCollectorTokenAccount: input.feeCollectorTokenAccount,
      renterTokenAccount: input.renterTokenAccount,
      signer: input.signer,
      tokenProgram: input.tokenProgram,
    } as never)
    .instruction();
}

export interface ClaimRentalRevenueInput {
  cranker: PublicKey;
  rental: PublicKey;
  templateId: Uint8Array;
  mint: PublicKey;
  authorTokenAccount: PublicKey;
  feeCollectorTokenAccount: PublicKey;
  tokenProgram: PublicKey;
}

export async function buildClaimRentalRevenueIx(
  program: Program<TemplateRegistry>,
  input: ClaimRentalRevenueInput,
): Promise<TransactionInstruction> {
  const [global] = templateGlobalPda(program.programId);
  const [template] = templatePda(program.programId, input.templateId);
  const [escrow] = rentalEscrowPda(program.programId, input.rental);

  return program.methods
    .claimRentalRevenue()
    .accounts({
      global,
      template,
      rental: input.rental,
      mint: input.mint,
      escrow,
      authorTokenAccount: input.authorTokenAccount,
      feeCollectorTokenAccount: input.feeCollectorTokenAccount,
      cranker: input.cranker,
      tokenProgram: input.tokenProgram,
    } as never)
    .instruction();
}
