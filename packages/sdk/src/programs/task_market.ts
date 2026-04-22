import { BN, Program } from '../anchor.js';
import {
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import type { TaskMarket } from '../generated/task_market.js';
import type { ClusterConfig } from '../cluster/index.js';
import {
  marketGlobalPda,
  taskPda,
  taskEscrowPda,
  agentAccountPda,
  agentRegistryGlobalPda,
  verifierConfigPda,
  verifierKeyPda,
  verifierModePda,
  proofVerifierAllowedCallersPda,
  reentrancyGuardPda,
  bidBookPda,
  bondEscrowPda,
  bidPda,
  guardPda,
} from '../pda/index.js';

const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

export type PersonhoodTierInput =
  | 'none'
  | 'basic'
  | 'verified'
  | { none: Record<string, never> }
  | { basic: Record<string, never> }
  | { verified: Record<string, never> };

export type LegacyCreateTaskPayloadKindInput =
  | {
      type: 'swapExact';
      inMint: PublicKey;
      outMint: PublicKey;
      amountIn: bigint;
      minOut: bigint;
    }
  | {
      type: 'transfer';
      mint: PublicKey;
      to: PublicKey;
      amount: bigint;
    }
  | {
      type: 'dataFetch';
      urlHash: Uint8Array;
      expectedHash: Uint8Array;
    }
  | {
      type: 'compute';
      circuitId: Uint8Array;
      publicInputsHash: Uint8Array;
    }
  | {
      type: 'generic';
      capabilityBit: number;
      argsHash: Uint8Array;
    };

export type StructuredTaskPayloadKindInput =
  | {
      swapExact: {
        inMint: PublicKey;
        outMint: PublicKey;
        amountIn: bigint;
        minOut: bigint;
      };
    }
  | { transfer: { mint: PublicKey; to: PublicKey; amount: bigint } }
  | { dataFetch: { urlHash: Uint8Array; expectedHash: Uint8Array } }
  | { compute: { circuitId: Uint8Array; publicInputsHash: Uint8Array } }
  | { generic: { capabilityBit: number; argsHash: Uint8Array } };

export interface CreateTaskPayloadInput {
  kind: LegacyCreateTaskPayloadKindInput | StructuredTaskPayloadKindInput;
  capabilityBit: number;
  criteria: Uint8Array;
  requiresPersonhood?: PersonhoodTierInput;
}

export type TaskPayloadInput = CreateTaskPayloadInput;

export interface CreateTaskInput {
  client: PublicKey;
  taskNonce: Uint8Array;
  agentDid: Uint8Array;
  agentOperator: PublicKey;
  agentId: Uint8Array;
  paymentMint: PublicKey;
  paymentAmount: bigint;
  payload: CreateTaskPayloadInput;
  criteriaRoot: Uint8Array;
  deadline: bigint;
  milestoneCount: number;
}

function toByteArray(bytes: Uint8Array, label: string, expectedLength?: number): number[] {
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new Error(`${label} must be ${expectedLength} bytes`);
  }
  return Array.from(bytes);
}

function normalizePersonhoodTier(tier: PersonhoodTierInput | undefined) {
  if (!tier || tier === 'none' || (typeof tier === 'object' && 'none' in tier)) return { none: {} };
  if (tier === 'basic' || (typeof tier === 'object' && 'basic' in tier)) return { basic: {} };
  return { verified: {} };
}

function normalizeTaskKind(kind: CreateTaskPayloadInput['kind']) {
  if ('type' in kind) {
    switch (kind.type) {
      case 'swapExact':
        return {
          swapExact: {
            inMint: kind.inMint,
            outMint: kind.outMint,
            amountIn: new BN(kind.amountIn.toString()),
            minOut: new BN(kind.minOut.toString()),
          },
        };
      case 'transfer':
        return {
          transfer: {
            mint: kind.mint,
            to: kind.to,
            amount: new BN(kind.amount.toString()),
          },
        };
      case 'dataFetch':
        return {
          dataFetch: {
            urlHash: toByteArray(kind.urlHash, 'payload.kind.urlHash', 32),
            expectedHash: toByteArray(kind.expectedHash, 'payload.kind.expectedHash', 32),
          },
        };
      case 'compute':
        return {
          compute: {
            circuitId: toByteArray(kind.circuitId, 'payload.kind.circuitId', 32),
            publicInputsHash: toByteArray(kind.publicInputsHash, 'payload.kind.publicInputsHash', 32),
          },
        };
      case 'generic':
        return {
          generic: {
            capabilityBit: kind.capabilityBit,
            argsHash: toByteArray(kind.argsHash, 'payload.kind.argsHash', 32),
          },
        };
    }
  }

  if ('swapExact' in kind) {
    return {
      swapExact: {
        inMint: kind.swapExact.inMint,
        outMint: kind.swapExact.outMint,
        amountIn: new BN(kind.swapExact.amountIn.toString()),
        minOut: new BN(kind.swapExact.minOut.toString()),
      },
    };
  }
  if ('transfer' in kind) {
    return {
      transfer: {
        mint: kind.transfer.mint,
        to: kind.transfer.to,
        amount: new BN(kind.transfer.amount.toString()),
      },
    };
  }
  if ('dataFetch' in kind) {
    return {
      dataFetch: {
        urlHash: toByteArray(kind.dataFetch.urlHash, 'payload.kind.urlHash', 32),
        expectedHash: toByteArray(kind.dataFetch.expectedHash, 'payload.kind.expectedHash', 32),
      },
    };
  }
  if ('compute' in kind) {
    return {
      compute: {
        circuitId: toByteArray(kind.compute.circuitId, 'payload.kind.circuitId', 32),
        publicInputsHash: toByteArray(kind.compute.publicInputsHash, 'payload.kind.publicInputsHash', 32),
      },
    };
  }

  return {
    generic: {
      capabilityBit: kind.generic.capabilityBit,
      argsHash: toByteArray(kind.generic.argsHash, 'payload.kind.argsHash', 32),
    },
  };
}

function normalizeTaskPayload(input: CreateTaskPayloadInput) {
  return {
    kind: normalizeTaskKind(input.kind),
    capabilityBit: input.capabilityBit,
    criteria: Buffer.from(input.criteria),
    requiresPersonhood: normalizePersonhoodTier(input.requiresPersonhood),
  };
}

export async function buildCreateTaskIx(
  program: Program<TaskMarket>,
  config: ClusterConfig,
  input: CreateTaskInput,
): Promise<TransactionInstruction> {
  const [global] = marketGlobalPda(program.programId);
  const [task] = taskPda(program.programId, input.client, input.taskNonce);
  const [registryGlobal] = agentRegistryGlobalPda(config.programIds.agentRegistry);
  const [agentAccount] = agentAccountPda(config.programIds.agentRegistry, input.agentOperator, input.agentId);

  return program.methods
    .createTask(
      Array.from(input.taskNonce),
      Array.from(input.agentDid),
      input.paymentMint,
      new BN(input.paymentAmount.toString()),
      normalizeTaskPayload(input.payload),
      Array.from(input.criteriaRoot),
      new BN(input.deadline.toString()),
      input.milestoneCount,
    )
    .accounts({
      global,
      task,
      client: input.client,
      agentRegistryProgram: config.programIds.agentRegistry,
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
  tokenProgramId?: PublicKey;
}

export async function buildFundTaskIx(
  program: Program<TaskMarket>,
  input: FundTaskInput,
): Promise<TransactionInstruction> {
  const [global] = marketGlobalPda(program.programId);
  const [escrow] = taskEscrowPda(program.programId, input.task);
  const [guard] = guardPda(program.programId);

  return program.methods
    .fundTask()
    .accounts({
      global,
      task: input.task,
      paymentMint: input.paymentMint,
      escrow,
      clientTokenAccount: input.clientTokenAccount,
      hookAllowlist: null,
      guard,
      client: input.client,
      tokenProgram: input.tokenProgramId ?? TOKEN_2022_PROGRAM_ID,
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
  config: ClusterConfig,
  input: SubmitResultInput,
): Promise<TransactionInstruction> {
  const [global] = marketGlobalPda(program.programId);

  return program.methods
    .submitResult(
      Array.from(input.resultHash),
      Array.from(input.proofKey),
    )
    .accounts({
      global,
      task: input.task,
      operator: input.operator,
      agentRegistryProgram: config.programIds.agentRegistry,
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
  config: ClusterConfig,
  input: VerifyTaskInput,
): Promise<TransactionInstruction> {
  const [global] = marketGlobalPda(program.programId);
  const [verConfig] = verifierConfigPda(config.programIds.proofVerifier);
  const [vk] = verifierKeyPda(config.programIds.proofVerifier, input.vkId);
  const [mode] = verifierModePda(config.programIds.proofVerifier);
  const [guard] = reentrancyGuardPda(program.programId);
  const [verifierSelfGuard] = reentrancyGuardPda(config.programIds.proofVerifier);
  const [verifierAllowedCallers] = proofVerifierAllowedCallersPda(config.programIds.proofVerifier);

  return program.methods
    .verifyTask(
      Array.from(input.proofA),
      Array.from(input.proofB),
      Array.from(input.proofC),
    )
    .accounts({
      global,
      task: input.task,
      proofVerifierProgram: config.programIds.proofVerifier,
      verifierConfig: verConfig,
      verifierKey: vk,
      verifierMode: mode,
      guard,
      verifierSelfGuard,
      verifierAllowedCallers,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
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
  hookAllowlist?: PublicKey | null;
  tokenProgramId?: PublicKey;
}

export async function buildReleaseIx(
  program: Program<TaskMarket>,
  config: ClusterConfig,
  input: ReleaseInput,
): Promise<TransactionInstruction> {
  const [global] = marketGlobalPda(program.programId);
  const [escrow] = taskEscrowPda(program.programId, input.task);
  const [registryGlobal] = agentRegistryGlobalPda(config.programIds.agentRegistry);
  const [guard] = reentrancyGuardPda(program.programId);

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
      agentRegistryProgram: config.programIds.agentRegistry,
      registryGlobal,
      agentAccount: input.agentAccount,
      selfProgram: config.programIds.taskMarket,
      hookAllowlist: input.hookAllowlist ?? null,
      guard,
      cranker: input.cranker,
      tokenProgram: input.tokenProgramId ?? TOKEN_2022_PROGRAM_ID,
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
  tokenProgramId?: PublicKey;
}

export async function buildExpireIx(
  program: Program<TaskMarket>,
  config: ClusterConfig,
  input: ExpireInput,
): Promise<TransactionInstruction> {
  const [global] = marketGlobalPda(program.programId);
  const [escrow] = taskEscrowPda(program.programId, input.task);
  const [registryGlobal] = agentRegistryGlobalPda(config.programIds.agentRegistry);

  return program.methods
    .expire()
    .accounts({
      global,
      task: input.task,
      paymentMint: input.paymentMint,
      escrow,
      clientTokenAccount: input.clientTokenAccount,
      client: input.client,
      agentRegistryProgram: config.programIds.agentRegistry,
      registryGlobal,
      agentAccount: input.agentAccount,
      selfProgram: config.programIds.taskMarket,
      cranker: input.cranker,
      tokenProgram: input.tokenProgramId ?? TOKEN_2022_PROGRAM_ID,
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

export interface DisputedTimeoutRefundInput {
  cranker: PublicKey;
  client: PublicKey;
  task: PublicKey;
  paymentMint: PublicKey;
  clientTokenAccount: PublicKey;
  tokenProgramId?: PublicKey;
}

export async function buildDisputedTimeoutRefundIx(
  program: Program<TaskMarket>,
  input: DisputedTimeoutRefundInput,
): Promise<TransactionInstruction> {
  const [global] = marketGlobalPda(program.programId);
  const [escrow] = taskEscrowPda(program.programId, input.task);

  // disputedTimeoutRefund not yet in generated IDL — cast until regen.
  const methods = program.methods as unknown as {
    disputedTimeoutRefund: () => {
      accounts: (a: Record<string, unknown>) => { instruction: () => Promise<TransactionInstruction> };
    };
  };

  return methods
    .disputedTimeoutRefund()
    .accounts({
      global,
      task: input.task,
      paymentMint: input.paymentMint,
      escrow,
      clientTokenAccount: input.clientTokenAccount,
      client: input.client,
      cranker: input.cranker,
      tokenProgram: input.tokenProgramId ?? TOKEN_2022_PROGRAM_ID,
    })
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
  tokenProgramId?: PublicKey;
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
      tokenProgram: input.tokenProgramId ?? TOKEN_2022_PROGRAM_ID,
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
  tokenProgramId?: PublicKey;
}

export async function buildCommitBidIx(
  program: Program<TaskMarket>,
  config: ClusterConfig,
  input: CommitBidInput,
): Promise<TransactionInstruction> {
  const [global] = marketGlobalPda(program.programId);
  const [registryGlobal] = agentRegistryGlobalPda(config.programIds.agentRegistry);
  const [bidBook] = bidBookPda(program.programId, input.taskId);
  const [bid] = bidPda(program.programId, input.taskId, input.bidder);
  const [bondEscrow] = bondEscrowPda(program.programId, input.taskId);
  const [agentAccount] = agentAccountPda(
    config.programIds.agentRegistry,
    input.agentOperator,
    input.agentId,
  );

  return program.methods
    .commitBid(
      Array.from(input.commitHash),
      Array.from(input.agentDid),
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
      agentRegistryProgram: config.programIds.agentRegistry,
      registryGlobal,
      agentAccount,
      personhoodAttestation: null,
      capabilityTag: null,
      hookAllowlist: null,
      tokenProgram: input.tokenProgramId ?? TOKEN_2022_PROGRAM_ID,
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
      Array.from(input.nonce),
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
  const [guard] = reentrancyGuardPda(program.programId);

  return program.methods
    .closeBidding()
    .accounts({
      global,
      task: input.task,
      bidBook,
      guard,
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
  tokenProgramId?: PublicKey;
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
      tokenProgram: input.tokenProgramId ?? TOKEN_2022_PROGRAM_ID,
    } as never)
    .instruction();
}

export interface CancelBiddingInput {
  client: PublicKey;
  task: PublicKey;
  taskId: Uint8Array;
  paymentMint: PublicKey;
  tokenProgramId?: PublicKey;
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
      tokenProgram: input.tokenProgramId ?? TOKEN_2022_PROGRAM_ID,
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
