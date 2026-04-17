import { BN, Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import type { GovernanceProgram } from '../generated/governance_program.js';
import {
  govConfigPda,
  programRegistryPda,
  govVoteRecordPda,
  executionRecordPda,
} from '../pda/index.js';

export interface ProposeInput {
  proposer: PublicKey;
  proposal: PublicKey;
  category: Record<string, never>;
  targetProgram: PublicKey;
  ixData: Uint8Array;
  metadataUri: Uint8Array;
  snapshot: {
    totalEligibleWeight: bigint;
    snapshotSlot: bigint;
    snapshotRoot: Uint8Array;
  };
}

export async function buildProposeIx(
  program: Program<GovernanceProgram>,
  input: ProposeInput,
): Promise<TransactionInstruction> {
  const [config] = govConfigPda(program.programId);
  const [registry] = programRegistryPda(program.programId);

  return program.methods
    .propose(
      input.category as never,
      input.targetProgram,
      Buffer.from(input.ixData),
      Buffer.from(input.metadataUri),
      {
        totalEligibleWeight: new BN(input.snapshot.totalEligibleWeight.toString()),
        snapshotSlot: new BN(input.snapshot.snapshotSlot.toString()),
        snapshotRoot: Array.from(input.snapshot.snapshotRoot),
      } as never,
    )
    .accounts({
      config,
      registry,
      proposal: input.proposal,
      proposer: input.proposer,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface VoteInput {
  proposal: PublicKey;
  voter: PublicKey;
  choice: Record<string, never>;
  weight: bigint;
  merkleProof: Uint8Array[];
}

export async function buildVoteIx(
  program: Program<GovernanceProgram>,
  input: VoteInput,
): Promise<TransactionInstruction> {
  const [config] = govConfigPda(program.programId);
  const [voteRecord] = govVoteRecordPda(program.programId, input.proposal, input.voter);

  return program.methods
    .vote(
      input.choice as never,
      new BN(input.weight.toString()),
      input.merkleProof.map((p) => Array.from(p)) as never,
    )
    .accounts({
      config,
      proposal: input.proposal,
      voteRecord,
      voter: input.voter,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface FinalizeVoteInput {
  proposal: PublicKey;
  cranker: PublicKey;
}

export async function buildFinalizeVoteIx(
  program: Program<GovernanceProgram>,
  input: FinalizeVoteInput,
): Promise<TransactionInstruction> {
  const [config] = govConfigPda(program.programId);
  const [registry] = programRegistryPda(program.programId);

  return program.methods
    .finalizeVote()
    .accounts({
      config,
      registry,
      proposal: input.proposal,
      cranker: input.cranker,
    } as never)
    .instruction();
}

export interface ExecuteProposalInput {
  proposal: PublicKey;
  executor: PublicKey;
}

export async function buildExecuteProposalIx(
  program: Program<GovernanceProgram>,
  input: ExecuteProposalInput,
): Promise<TransactionInstruction> {
  const [config] = govConfigPda(program.programId);
  const [registry] = programRegistryPda(program.programId);
  const [executionRecord] = executionRecordPda(program.programId, input.proposal);

  return program.methods
    .executeProposal()
    .accounts({
      config,
      registry,
      proposal: input.proposal,
      executionRecord,
      executor: input.executor,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface ExpireProposalInput {
  proposal: PublicKey;
  cranker: PublicKey;
}

export async function buildExpireProposalIx(
  program: Program<GovernanceProgram>,
  input: ExpireProposalInput,
): Promise<TransactionInstruction> {
  return program.methods
    .expireProposal()
    .accounts({
      proposal: input.proposal,
      cranker: input.cranker,
    } as never)
    .instruction();
}

export interface ProposerCancelInput {
  proposal: PublicKey;
  proposer: PublicKey;
}

export async function buildProposerCancelIx(
  program: Program<GovernanceProgram>,
  input: ProposerCancelInput,
): Promise<TransactionInstruction> {
  return program.methods
    .proposerCancel()
    .accounts({
      proposal: input.proposal,
      proposer: input.proposer,
    } as never)
    .instruction();
}

export interface QueueExecutionInput {
  proposal: PublicKey;
  cranker: PublicKey;
}

export async function buildQueueExecutionIx(
  program: Program<GovernanceProgram>,
  input: QueueExecutionInput,
): Promise<TransactionInstruction> {
  return program.methods
    .queueExecution()
    .accounts({
      proposal: input.proposal,
      cranker: input.cranker,
    } as never)
    .instruction();
}
