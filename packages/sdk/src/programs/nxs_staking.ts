import { BN, Program } from '../anchor.js';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import type { NxsStaking } from '../generated/nxs_staking.js';
import {
  stakingPoolPda,
  stakeAccountPda,
  stakeVaultPda,
  stakingConfigPda,
  votingPowerSnapshotPda,
} from '../pda/index.js';

export interface StakeInput {
  owner: PublicKey;
  stakeMint: PublicKey;
  ownerTokenAccount: PublicKey;
  amount: bigint;
  lockupDurationSecs: bigint;
  tokenProgram: PublicKey;
}

export async function buildStakeIx(
  program: Program<NxsStaking>,
  input: StakeInput,
): Promise<TransactionInstruction> {
  const [pool] = stakingPoolPda(program.programId);
  const [stakeAccount] = stakeAccountPda(program.programId, pool, input.owner);
  const [vault] = stakeVaultPda(program.programId, stakeAccount);

  return program.methods
    .stake(
      new BN(input.amount.toString()),
      new BN(input.lockupDurationSecs.toString()),
    )
    .accounts({
      pool,
      stakeAccount,
      stakeMint: input.stakeMint,
      vault,
      ownerTokenAccount: input.ownerTokenAccount,
      owner: input.owner,
      tokenProgram: input.tokenProgram,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface BeginUnstakeInput {
  owner: PublicKey;
}

export async function buildBeginUnstakeIx(
  program: Program<NxsStaking>,
  input: BeginUnstakeInput,
): Promise<TransactionInstruction> {
  const [pool] = stakingPoolPda(program.programId);
  const [stakeAccount] = stakeAccountPda(program.programId, pool, input.owner);

  return program.methods
    .beginUnstake()
    .accounts({
      pool,
      stakeAccount,
      owner: input.owner,
    } as never)
    .instruction();
}

export interface StakeWithdrawInput {
  owner: PublicKey;
  stakeMint: PublicKey;
  ownerTokenAccount: PublicKey;
  tokenProgram: PublicKey;
}

export async function buildStakeWithdrawIx(
  program: Program<NxsStaking>,
  input: StakeWithdrawInput,
): Promise<TransactionInstruction> {
  const [pool] = stakingPoolPda(program.programId);
  const [stakeAccount] = stakeAccountPda(program.programId, pool, input.owner);
  const [vault] = stakeVaultPda(program.programId, stakeAccount);

  return program.methods
    .withdraw()
    .accounts({
      pool,
      stakeAccount,
      stakeMint: input.stakeMint,
      vault,
      ownerTokenAccount: input.ownerTokenAccount,
      owner: input.owner,
      tokenProgram: input.tokenProgram,
    } as never)
    .instruction();
}

export interface SnapshotEpochInput {
  authority: PublicKey;
  totalVotingPower: bigint;
  stakerCount: number;
  currentEpoch: bigint;
}

export async function buildSnapshotEpochIx(
  program: Program<NxsStaking>,
  input: SnapshotEpochInput,
): Promise<TransactionInstruction> {
  const [config] = stakingConfigPda(program.programId);
  const [pool] = stakingPoolPda(program.programId);
  const [snapshot] = votingPowerSnapshotPda(program.programId, input.currentEpoch);

  return program.methods
    .snapshotEpoch(
      new BN(input.totalVotingPower.toString()),
      input.stakerCount,
    )
    .accounts({
      config,
      pool,
      snapshot,
      authority: input.authority,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}
