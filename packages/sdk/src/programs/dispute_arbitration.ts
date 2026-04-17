import { BN, Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import type { DisputeArbitration } from '../generated/dispute_arbitration.js';
import {
  disputeConfigPda,
  disputePoolPda,
  arbitratorPda,
  disputeVotePda,
  appealPda,
  pendingSlashPda,
} from '../pda/index.js';

export interface DisputeRaiseInput {
  disputeCase: PublicKey;
  payer: PublicKey;
  taskId: bigint;
  client: PublicKey;
  agentOperator: PublicKey;
  escrowAmount: bigint;
  paymentMint: PublicKey;
}

export async function buildDisputeRaiseIx(
  program: Program<DisputeArbitration>,
  input: DisputeRaiseInput,
): Promise<TransactionInstruction> {
  const [config] = disputeConfigPda(program.programId);
  const [pool] = disputePoolPda(program.programId);

  return program.methods
    .raiseDispute(
      new BN(input.taskId.toString()),
      input.client,
      input.agentOperator,
      new BN(input.escrowAmount.toString()),
      input.paymentMint,
    )
    .accounts({
      config,
      disputeCase: input.disputeCase,
      pool,
      payer: input.payer,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface CommitVoteInput {
  disputeCase: PublicKey;
  arbitratorSigner: PublicKey;
  operator: PublicKey;
  caseId: bigint;
  commitHash: Uint8Array;
}

export async function buildCommitVoteIx(
  program: Program<DisputeArbitration>,
  input: CommitVoteInput,
): Promise<TransactionInstruction> {
  const [config] = disputeConfigPda(program.programId);
  const [arbitrator] = arbitratorPda(program.programId, input.arbitratorSigner);
  const [voteRecord] = disputeVotePda(program.programId, input.caseId, arbitrator);

  return program.methods
    .commitVote(Array.from(input.commitHash) as never)
    .accounts({
      config,
      disputeCase: input.disputeCase,
      arbitrator,
      voteRecord,
      operator: input.operator,
      arbitratorSigner: input.arbitratorSigner,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface RevealVoteInput {
  disputeCase: PublicKey;
  arbitratorSigner: PublicKey;
  caseId: bigint;
  verdict: Record<string, never>;
  salt: Uint8Array;
}

export async function buildRevealVoteIx(
  program: Program<DisputeArbitration>,
  input: RevealVoteInput,
): Promise<TransactionInstruction> {
  const [config] = disputeConfigPda(program.programId);
  const [arbitrator] = arbitratorPda(program.programId, input.arbitratorSigner);
  const [voteRecord] = disputeVotePda(program.programId, input.caseId, arbitrator);

  return program.methods
    .revealVote(input.verdict as never, Array.from(input.salt) as never)
    .accounts({
      config,
      disputeCase: input.disputeCase,
      arbitrator,
      voteRecord,
      arbitratorSigner: input.arbitratorSigner,
    } as never)
    .instruction();
}

export interface ResolveDisputeInput {
  disputeCase: PublicKey;
  cranker: PublicKey;
}

export async function buildResolveDisputeIx(
  program: Program<DisputeArbitration>,
  input: ResolveDisputeInput,
): Promise<TransactionInstruction> {
  const [config] = disputeConfigPda(program.programId);

  return program.methods
    .resolveDispute()
    .accounts({
      config,
      disputeCase: input.disputeCase,
      cranker: input.cranker,
    } as never)
    .instruction();
}

export interface EscalateAppealInput {
  disputeCase: PublicKey;
  appellant: PublicKey;
  caseId: bigint;
}

export async function buildEscalateAppealIx(
  program: Program<DisputeArbitration>,
  input: EscalateAppealInput,
): Promise<TransactionInstruction> {
  const [config] = disputeConfigPda(program.programId);
  const [appealRecord] = appealPda(program.programId, input.caseId);

  return program.methods
    .escalateAppeal()
    .accounts({
      config,
      disputeCase: input.disputeCase,
      appealRecord,
      appellant: input.appellant,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface RegisterArbitratorInput {
  operator: PublicKey;
  stakeAccount: PublicKey;
  effectiveStake: bigint;
  lockEnd: bigint;
}

export async function buildRegisterArbitratorIx(
  program: Program<DisputeArbitration>,
  input: RegisterArbitratorInput,
): Promise<TransactionInstruction> {
  const [config] = disputeConfigPda(program.programId);
  const [arbitrator] = arbitratorPda(program.programId, input.operator);

  return program.methods
    .registerArbitrator(
      new BN(input.effectiveStake.toString()),
      new BN(input.lockEnd.toString()),
    )
    .accounts({
      config,
      arbitrator,
      stakeAccount: input.stakeAccount,
      operator: input.operator,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface SlashArbitratorInput {
  disputeCase: PublicKey;
  arbitratorOperator: PublicKey;
  proposer: PublicKey;
  reasonCode: number;
}

export async function buildSlashArbitratorIx(
  program: Program<DisputeArbitration>,
  input: SlashArbitratorInput,
): Promise<TransactionInstruction> {
  const [config] = disputeConfigPda(program.programId);
  const [arbitrator] = arbitratorPda(program.programId, input.arbitratorOperator);
  const [pendingSlash] = pendingSlashPda(program.programId, input.arbitratorOperator);

  return program.methods
    .slashArbitrator(input.reasonCode)
    .accounts({
      config,
      disputeCase: input.disputeCase,
      arbitrator,
      pendingSlash,
      proposer: input.proposer,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface TallyRoundInput {
  disputeCase: PublicKey;
  cranker: PublicKey;
}

export async function buildTallyRoundIx(
  program: Program<DisputeArbitration>,
  input: TallyRoundInput,
): Promise<TransactionInstruction> {
  return program.methods
    .tallyRound()
    .accounts({
      disputeCase: input.disputeCase,
      cranker: input.cranker,
    } as never)
    .instruction();
}
