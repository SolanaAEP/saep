import { BN, Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import type { FeeCollector } from '../generated/fee_collector.js';
import {
  feeConfigPda,
  epochPda,
  claimPda,
  intakeVaultPda,
  burnVaultPda,
  stakerVaultPda,
} from '../pda/index.js';

export interface ClaimStakerInput {
  staker: PublicKey;
  saepMint: PublicKey;
  stakerTokenAccount: PublicKey;
  epochId: bigint;
  amount: bigint;
  merkleProof: Uint8Array[];
  tokenProgram: PublicKey;
}

export async function buildClaimStakerIx(
  program: Program<FeeCollector>,
  input: ClaimStakerInput,
): Promise<TransactionInstruction> {
  const [config] = feeConfigPda(program.programId);
  const [epoch] = epochPda(program.programId, input.epochId);
  const [claim] = claimPda(program.programId, input.epochId, input.staker);
  const [stakerVault] = stakerVaultPda(program.programId);

  return program.methods
    .claimStaker(
      new BN(input.epochId.toString()),
      new BN(input.amount.toString()),
      input.merkleProof.map((p) => Array.from(p)) as never,
    )
    .accounts({
      config,
      epoch,
      claim,
      saepMint: input.saepMint,
      stakerVault,
      stakerTokenAccount: input.stakerTokenAccount,
      staker: input.staker,
      tokenProgram: input.tokenProgram,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface ProcessEpochInput {
  cranker: PublicKey;
  saepMint: PublicKey;
  grantRecipient: PublicKey;
  treasuryRecipient: PublicKey;
  currentEpochId: bigint;
  nextEpochId: bigint;
  snapshotId: bigint;
  tokenProgram: PublicKey;
}

export async function buildProcessEpochIx(
  program: Program<FeeCollector>,
  input: ProcessEpochInput,
): Promise<TransactionInstruction> {
  const [config] = feeConfigPda(program.programId);
  const [currentEpoch] = epochPda(program.programId, input.currentEpochId);
  const [nextEpoch] = epochPda(program.programId, input.nextEpochId);
  const [intakeVault] = intakeVaultPda(program.programId);
  const [burnVault] = burnVaultPda(program.programId);
  const [stakerVault] = stakerVaultPda(program.programId);

  return program.methods
    .processEpoch(new BN(input.snapshotId.toString()))
    .accounts({
      config,
      currentEpoch,
      nextEpoch,
      saepMint: input.saepMint,
      intakeVault,
      burnVault,
      stakerVault,
      grantRecipient: input.grantRecipient,
      treasuryRecipient: input.treasuryRecipient,
      cranker: input.cranker,
      tokenProgram: input.tokenProgram,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface ExecuteBurnInput {
  cranker: PublicKey;
  saepMint: PublicKey;
  epochId: bigint;
  tokenProgram: PublicKey;
}

export async function buildExecuteBurnIx(
  program: Program<FeeCollector>,
  input: ExecuteBurnInput,
): Promise<TransactionInstruction> {
  const [config] = feeConfigPda(program.programId);
  const [epoch] = epochPda(program.programId, input.epochId);
  const [burnVault] = burnVaultPda(program.programId);

  return program.methods
    .executeBurn(new BN(input.epochId.toString()))
    .accounts({
      config,
      epoch,
      saepMint: input.saepMint,
      burnVault,
      cranker: input.cranker,
      tokenProgram: input.tokenProgram,
    } as never)
    .instruction();
}
