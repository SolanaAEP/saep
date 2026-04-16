import { BN, Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import type { TaskMarket } from '../generated/task_market.js';
import {
  marketGlobalPda,
  taskPda,
  taskEscrowPda,
  agentAccountPda,
  agentRegistryGlobalPda,
  verifierConfigPda,
  verifierKeyPda,
  verifierModePda,
  bidBookPda,
  bondEscrowPda,
  bidPda,
} from '../pda/index.js';

const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const AGENT_REGISTRY_PROGRAM_ID = new PublicKey('EQJ4Lp2gxJDD5hs185aDcermYWdAi4cQeSKfnuqLAQYu');
const PROOF_VERIFIER_PROGRAM_ID = new PublicKey('DcJx1p6bcNuFm4i5WMgK4uGZitc1bf4Ubc5d4sctZKVe');
const TASK_MARKET_PROGRAM_ID = new PublicKey('HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w');

export interface CreateTaskInput {
  client: PublicKey;
  taskNonce: Uint8Array;
  agentDid: Uint8Array;
  agentOperator: PublicKey;
  agentId: Uint8Array;
  paymentMint: PublicKey;
  paymentAmount: bigint;
  taskHash: Uint8Array;
  criteriaRoot: Uint8Array;
  deadline: bigint;
  milestoneCount: number;
}

export async function buildCreateTaskIx(
  program: Program<TaskMarket>,
  input: CreateTaskInput,
): Promise<TransactionInstruction> {
  const [global] = marketGlobalPda(program.programId);
  const [task] = taskPda(program.programId, input.client, input.taskNonce);
  const [registryGlobal] = agentRegistryGlobalPda(AGENT_REGISTRY_PROGRAM_ID);
  const [agentAccount] = agentAccountPda(AGENT_REGISTRY_PROGRAM_ID, input.agentOperator, input.agentId);

  return program.methods
    .createTask(
      Array.from(input.taskNonce) as unknown as number[],
      Array.from(input.agentDid) as unknown as number[],
      input.paymentMint,
      new BN(input.paymentAmount.toString()),
      Array.from(input.taskHash) as unknown as number[],
      Array.from(input.criteriaRoot) as unknown as number[],
      new BN(input.deadline.toString()),
      input.milestoneCount,
    )
    .accounts({
      global,
      task,
      client: input.client,
      agentRegistryProgram: AGENT_REGISTRY_PROGRAM_ID,
      registryGlobal,
      agentAccount,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface FundTaskInput {
  client: PublicKey;
  task: PublicKey;
  paymentMint: PublicKey;
  clientTokenAccount: PublicKey;
}

export async function buildFundTaskIx(
  program: Program<TaskMarket>,
  input: FundTaskInput,
): Promise<TransactionInstruction> {
  const [global] = marketGlobalPda(program.programId);
  const [escrow] = taskEscrowPda(program.programId, input.task);

  return program.methods
    .fundTask()
    .accounts({
      global,
      task: input.task,
      paymentMint: input.paymentMint,
      escrow,
      clientTokenAccount: input.clientTokenAccount,
      client: input.client,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface SubmitResultInput {
  operator: PublicKey;
  task: PublicKey;
  agentAccount: PublicKey;
  resultHash: Uint8Array;
  proofKey: Uint8Array;
}

export async function buildSubmitResultIx(
  program: Program<TaskMarket>,
  input: SubmitResultInput,
): Promise<TransactionInstruction> {
  const [global] = marketGlobalPda(program.programId);

  return program.methods
    .submitResult(
      Array.from(input.resultHash) as unknown as number[],
      Array.from(input.proofKey) as unknown as number[],
    )
    .accounts({
      global,
      task: input.task,
      operator: input.operator,
      agentRegistryProgram: AGENT_REGISTRY_PROGRAM_ID,
      agentAccount: input.agentAccount,
    } as never)
    .instruction();
}

export interface VerifyTaskInput {
  cranker: PublicKey;
  task: PublicKey;
  verifierKey: PublicKey;
  vkId: Uint8Array;
  proofA: Uint8Array;
  proofB: Uint8Array;
  proofC: Uint8Array;
}

export async function buildVerifyTaskIx(
  program: Program<TaskMarket>,
  input: VerifyTaskInput,
): Promise<TransactionInstruction> {
  const [global] = marketGlobalPda(program.programId);
  const [verConfig] = verifierConfigPda(PROOF_VERIFIER_PROGRAM_ID);
  const [vk] = verifierKeyPda(PROOF_VERIFIER_PROGRAM_ID, input.vkId);
  const [mode] = verifierModePda(PROOF_VERIFIER_PROGRAM_ID);

  return program.methods
    .verifyTask(
      Array.from(input.proofA) as unknown as number[],
      Array.from(input.proofB) as unknown as number[],
      Array.from(input.proofC) as unknown as number[],
    )
    .accounts({
      global,
      task: input.task,
      proofVerifierProgram: PROOF_VERIFIER_PROGRAM_ID,
      verifierConfig: verConfig,
      verifierKey: vk,
      verifierMode: mode,
      cranker: input.cranker,
    } as never)
    .instruction();
}

export interface ReleaseInput {
  cranker: PublicKey;
  task: PublicKey;
  paymentMint: PublicKey;
  agentTokenAccount: PublicKey;
  feeCollectorTokenAccount: PublicKey;
  solrepPoolTokenAccount: PublicKey;
  agentAccount: PublicKey;
  client: PublicKey;
}

export async function buildReleaseIx(
  program: Program<TaskMarket>,
  input: ReleaseInput,
): Promise<TransactionInstruction> {
  const [global] = marketGlobalPda(program.programId);
  const [escrow] = taskEscrowPda(program.programId, input.task);
  const [registryGlobal] = agentRegistryGlobalPda(AGENT_REGISTRY_PROGRAM_ID);

  return program.methods
    .release()
    .accounts({
      global,
      task: input.task,
      paymentMint: input.paymentMint,
      escrow,
      agentTokenAccount: input.agentTokenAccount,
      feeCollectorTokenAccount: input.feeCollectorTokenAccount,
      solrepPoolTokenAccount: input.solrepPoolTokenAccount,
      agentRegistryProgram: AGENT_REGISTRY_PROGRAM_ID,
      registryGlobal,
      agentAccount: input.agentAccount,
      selfProgram: TASK_MARKET_PROGRAM_ID,
      cranker: input.cranker,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    } as never)
    .instruction();
}

export interface ExpireInput {
  cranker: PublicKey;
  task: PublicKey;
  paymentMint: PublicKey;
  clientTokenAccount: PublicKey;
  client: PublicKey;
  agentAccount: PublicKey;
}

export async function buildExpireIx(
  program: Program<TaskMarket>,
  input: ExpireInput,
): Promise<TransactionInstruction> {
  const [global] = marketGlobalPda(program.programId);
  const [escrow] = taskEscrowPda(program.programId, input.task);
  const [registryGlobal] = agentRegistryGlobalPda(AGENT_REGISTRY_PROGRAM_ID);

  return program.methods
    .expire()
    .accounts({
      global,
      task: input.task,
      paymentMint: input.paymentMint,
      escrow,
      clientTokenAccount: input.clientTokenAccount,
      client: input.client,
      agentRegistryProgram: AGENT_REGISTRY_PROGRAM_ID,
      registryGlobal,
      agentAccount: input.agentAccount,
      selfProgram: TASK_MARKET_PROGRAM_ID,
      cranker: input.cranker,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    } as never)
    .instruction();
}

export interface RaiseDisputeInput {
  client: PublicKey;
  task: PublicKey;
}

export async function buildRaiseDisputeIx(
  program: Program<TaskMarket>,
  input: RaiseDisputeInput,
): Promise<TransactionInstruction> {
  return program.methods
    .raiseDispute()
    .accounts({
      task: input.task,
      client: input.client,
    } as never)
    .instruction();
}

export interface OpenBiddingInput {
  client: PublicKey;
  task: PublicKey;
  taskId: Uint8Array;
  paymentMint: PublicKey;
  commitSecs: bigint;
  revealSecs: bigint;
  bondBps: number;
}

export async function buildOpenBiddingIx(
  program: Program<TaskMarket>,
  input: OpenBiddingInput,
): Promise<TransactionInstruction> {
  const [global] = marketGlobalPda(program.programId);
  const [bidBook] = bidBookPda(program.programId, input.taskId);
  const [bondEscrow] = bondEscrowPda(program.programId, input.taskId);

  return program.methods
    .openBidding(
      new BN(input.commitSecs.toString()),
      new BN(input.revealSecs.toString()),
      input.bondBps,
    )
    .accounts({
      global,
      task: input.task,
      bidBook,
      paymentMint: input.paymentMint,
      bondEscrow,
      client: input.client,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface CommitBidInput {
  bidder: PublicKey;
  task: PublicKey;
  taskId: Uint8Array;
  paymentMint: PublicKey;
  bidderTokenAccount: PublicKey;
  agentOperator: PublicKey;
  agentId: Uint8Array;
  agentDid: Uint8Array;
  commitHash: Uint8Array;
}

export async function buildCommitBidIx(
  program: Program<TaskMarket>,
  input: CommitBidInput,
): Promise<TransactionInstruction> {
  const [global] = marketGlobalPda(program.programId);
  const [bidBook] = bidBookPda(program.programId, input.taskId);
  const [bid] = bidPda(program.programId, input.taskId, input.bidder);
  const [bondEscrow] = bondEscrowPda(program.programId, input.taskId);
  const [agentAccount] = agentAccountPda(
    AGENT_REGISTRY_PROGRAM_ID,
    input.agentOperator,
    input.agentId,
  );

  return program.methods
    .commitBid(
      Array.from(input.commitHash) as unknown as number[],
      Array.from(input.agentDid) as unknown as number[],
    )
    .accounts({
      global,
      task: input.task,
      bidBook,
      bid,
      paymentMint: input.paymentMint,
      bondEscrow,
      bidderTokenAccount: input.bidderTokenAccount,
      bidder: input.bidder,
      agentRegistryProgram: AGENT_REGISTRY_PROGRAM_ID,
      agentAccount,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface RevealBidInput {
  bidder: PublicKey;
  task: PublicKey;
  taskId: Uint8Array;
  amount: bigint;
  nonce: Uint8Array;
}

export async function buildRevealBidIx(
  program: Program<TaskMarket>,
  input: RevealBidInput,
): Promise<TransactionInstruction> {
  const [bidBook] = bidBookPda(program.programId, input.taskId);
  const [bid] = bidPda(program.programId, input.taskId, input.bidder);

  return program.methods
    .revealBid(
      new BN(input.amount.toString()),
      Array.from(input.nonce) as unknown as number[],
    )
    .accounts({
      task: input.task,
      bidBook,
      bid,
      bidder: input.bidder,
    } as never)
    .instruction();
}

export interface CloseBiddingInput {
  cranker: PublicKey;
  task: PublicKey;
  taskId: Uint8Array;
}

export async function buildCloseBiddingIx(
  program: Program<TaskMarket>,
  input: CloseBiddingInput,
): Promise<TransactionInstruction> {
  const [global] = marketGlobalPda(program.programId);
  const [bidBook] = bidBookPda(program.programId, input.taskId);

  return program.methods
    .closeBidding()
    .accounts({
      global,
      task: input.task,
      bidBook,
      cranker: input.cranker,
    } as never)
    .instruction();
}

export interface ClaimBondInput {
  bidder: PublicKey;
  task: PublicKey;
  taskId: Uint8Array;
  paymentMint: PublicKey;
  bidderTokenAccount: PublicKey;
  feeCollectorTokenAccount: PublicKey;
}

export async function buildClaimBondIx(
  program: Program<TaskMarket>,
  input: ClaimBondInput,
): Promise<TransactionInstruction> {
  const [global] = marketGlobalPda(program.programId);
  const [bidBook] = bidBookPda(program.programId, input.taskId);
  const [bid] = bidPda(program.programId, input.taskId, input.bidder);
  const [bondEscrow] = bondEscrowPda(program.programId, input.taskId);

  return program.methods
    .claimBond()
    .accounts({
      global,
      task: input.task,
      bidBook,
      bid,
      paymentMint: input.paymentMint,
      bondEscrow,
      bidderTokenAccount: input.bidderTokenAccount,
      feeCollectorTokenAccount: input.feeCollectorTokenAccount,
      bidder: input.bidder,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    } as never)
    .instruction();
}

export interface CancelBiddingInput {
  client: PublicKey;
  task: PublicKey;
  taskId: Uint8Array;
  paymentMint: PublicKey;
}

export async function buildCancelBiddingIx(
  program: Program<TaskMarket>,
  input: CancelBiddingInput,
): Promise<TransactionInstruction> {
  const [bidBook] = bidBookPda(program.programId, input.taskId);
  const [bondEscrow] = bondEscrowPda(program.programId, input.taskId);

  return program.methods
    .cancelBidding()
    .accounts({
      task: input.task,
      bidBook,
      paymentMint: input.paymentMint,
      bondEscrow,
      client: input.client,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    } as never)
    .instruction();
}

export interface CancelUnfundedTaskInput {
  client: PublicKey;
  task: PublicKey;
}

export async function buildCancelUnfundedTaskIx(
  program: Program<TaskMarket>,
  input: CancelUnfundedTaskInput,
): Promise<TransactionInstruction> {
  return program.methods
    .cancelUnfundedTask()
    .accounts({
      task: input.task,
      client: input.client,
    } as never)
    .instruction();
}
