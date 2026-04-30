import { BN, Program } from '../anchor.js';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import type { FeeCollector } from '../generated/fee_collector.js';
import {
  feeConfigPda,
  epochPda,
  claimPda,
  intakeVaultPda,
  burnVaultPda,
  stakerVaultPda,
  depositVaultPda,
  mintAuthorityPda,
  transferFeeWithdrawAuthorityPda,
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

export interface DepositSaepInput {
  depositor: PublicKey;
  externalMint: PublicKey;
  internalMint: PublicKey;
  depositorExternal: PublicKey;
  depositorInternal: PublicKey;
  externalTokenProgram: PublicKey;
  internalTokenProgram: PublicKey;
  amount: bigint;
}

export async function buildDepositSaepIx(
  program: Program<FeeCollector>,
  input: DepositSaepInput,
): Promise<TransactionInstruction> {
  const [config] = feeConfigPda(program.programId);
  const [depositVault] = depositVaultPda(program.programId);
  const [mintAuthority] = mintAuthorityPda(program.programId);

  return program.methods
    .depositSaep(new BN(input.amount.toString()))
    .accounts({
      config,
      externalMint: input.externalMint,
      internalMint: input.internalMint,
      depositorExternal: input.depositorExternal,
      depositorInternal: input.depositorInternal,
      depositVault,
      mintAuthority,
      depositor: input.depositor,
      externalTokenProgram: input.externalTokenProgram,
      internalTokenProgram: input.internalTokenProgram,
    } as never)
    .instruction();
}

export interface WithdrawSaepInput {
  withdrawer: PublicKey;
  externalMint: PublicKey;
  internalMint: PublicKey;
  withdrawerExternal: PublicKey;
  withdrawerInternal: PublicKey;
  externalTokenProgram: PublicKey;
  internalTokenProgram: PublicKey;
  amount: bigint;
}

export async function buildWithdrawSaepIx(
  program: Program<FeeCollector>,
  input: WithdrawSaepInput,
): Promise<TransactionInstruction> {
  const [config] = feeConfigPda(program.programId);
  const [depositVault] = depositVaultPda(program.programId);
  const [mintAuthority] = mintAuthorityPda(program.programId);

  return program.methods
    .withdrawSaep(new BN(input.amount.toString()))
    .accounts({
      config,
      externalMint: input.externalMint,
      internalMint: input.internalMint,
      withdrawerInternal: input.withdrawerInternal,
      withdrawerExternal: input.withdrawerExternal,
      depositVault,
      mintAuthority,
      withdrawer: input.withdrawer,
      externalTokenProgram: input.externalTokenProgram,
      internalTokenProgram: input.internalTokenProgram,
    } as never)
    .instruction();
}

export interface HarvestFeesInput {
  cranker: PublicKey;
  saepMint: PublicKey;
  currentEpochId: bigint;
  tokenProgram: PublicKey;
  remainingAccounts?: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
}

export async function buildHarvestTransferFeesIx(
  program: Program<FeeCollector>,
  input: HarvestFeesInput,
): Promise<TransactionInstruction> {
  const [config] = feeConfigPda(program.programId);
  const [currentEpoch] = epochPda(program.programId, input.currentEpochId);
  const [intakeVault] = intakeVaultPda(program.programId);
  const [feeWithdrawAuthority] = transferFeeWithdrawAuthorityPda(program.programId);

  let builder = program.methods
    .harvestTransferFees()
    .accounts({
      config,
      currentEpoch,
      saepMint: input.saepMint,
      intakeVault,
      feeWithdrawAuthority,
      cranker: input.cranker,
      tokenProgram: input.tokenProgram,
    } as never);

  if (input.remainingAccounts?.length) {
    builder = builder.remainingAccounts(input.remainingAccounts);
  }

  return builder.instruction();
}

export async function buildHarvestConfidentialFeesIx(
  program: Program<FeeCollector>,
  input: HarvestFeesInput,
): Promise<TransactionInstruction> {
  const [config] = feeConfigPda(program.programId);
  const [currentEpoch] = epochPda(program.programId, input.currentEpochId);
  const [intakeVault] = intakeVaultPda(program.programId);
  const [feeWithdrawAuthority] = transferFeeWithdrawAuthorityPda(program.programId);

  let builder = program.methods
    .harvestConfidentialFees()
    .accounts({
      config,
      currentEpoch,
      saepMint: input.saepMint,
      intakeVault,
      feeWithdrawAuthority,
      cranker: input.cranker,
      tokenProgram: input.tokenProgram,
    } as never);

  if (input.remainingAccounts?.length) {
    builder = builder.remainingAccounts(input.remainingAccounts);
  }

  return builder.instruction();
}

export interface CommitDistributionRootInput {
  committer: PublicKey;
  epochId: bigint;
  root: Uint8Array;
  leafCount: number;
  totalWeight: bigint;
}

export async function buildCommitDistributionRootIx(
  program: Program<FeeCollector>,
  input: CommitDistributionRootInput,
): Promise<TransactionInstruction> {
  const [config] = feeConfigPda(program.programId);
  const [epoch] = epochPda(program.programId, input.epochId);

  return program.methods
    .commitDistributionRoot(
      new BN(input.epochId.toString()),
      Array.from(input.root) as never,
      input.leafCount,
      new BN(input.totalWeight.toString()),
    )
    .accounts({
      config,
      epoch,
      committer: input.committer,
    } as never)
    .instruction();
}

export interface SetConfidentialTransfersInput {
  authority: PublicKey;
  enabled: boolean;
}

export async function buildSetConfidentialTransfersIx(
  program: Program<FeeCollector>,
  input: SetConfidentialTransfersInput,
): Promise<TransactionInstruction> {
  const [config] = feeConfigPda(program.programId);

  return program.methods
    .setConfidentialTransfers(input.enabled)
    .accounts({
      config,
      authority: input.authority,
    } as never)
    .instruction();
}
