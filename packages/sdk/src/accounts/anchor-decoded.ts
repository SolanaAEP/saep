/**
 * Interfaces matching the runtime shape that Anchor's BorshAccountsCoder
 * produces when decoding on-chain accounts.  These replace the pervasive
 * `Record<string, unknown>` casts that were scattered through accounts/.
 *
 * Anchor decodes:
 *  - Rust enums as `{ variantName: {} }` (Record<string, Record<string, never>>)
 *  - u64/u128/i64 fields as BN
 *  - [u8; N] arrays as number[]
 *  - Option<T> as T | null
 *  - Pubkey as PublicKey
 *  - bool as boolean
 *  - u8/u16/u32 as number
 */
import type { BN } from '@coral-xyz/anchor';
import type { PublicKey } from '@solana/web3.js';

// Anchor enum representation: exactly one key whose value is `{}`.
export type AnchorEnum<K extends string = string> = { [key in K]?: Record<string, never> };

export type AgentStatusEnum = AnchorEnum<'active' | 'paused' | 'suspended' | 'deregistered'>;
export type StreamStatusEnum = AnchorEnum<'active' | 'paused' | 'closed' | 'expired'>;
export type TaskStatusEnum = AnchorEnum<
  'created' | 'funded' | 'inExecution' | 'proofSubmitted' | 'verified' | 'released' | 'expired' | 'disputed' | 'resolved'
>;
export type BidPhaseEnum = AnchorEnum<'commit' | 'reveal' | 'settled' | 'cancelled'>;
export type ProposalCategoryEnum = AnchorEnum<
  'parameterChange' | 'programUpgrade' | 'treasurySpend' | 'emergencyPause' | 'capabilityTagUpdate' | 'meta'
>;
export type ProposalStatusEnum = AnchorEnum<
  'voting' | 'passed' | 'rejected' | 'queued' | 'executed' | 'failed' | 'cancelled' | 'expired'
>;

export interface DecodedReputationScore {
  quality: number;
  timeliness: number;
  availability: number;
  costEfficiency: number;
  honesty: number;
  volume: number;
  sampleCount: number;
  lastUpdate: BN;
}

export interface DecodedAgentAccount {
  operator: PublicKey;
  agentId: number[];
  did: number[];
  manifestUri: number[];
  capabilityMask: BN;
  priceLamports: BN;
  streamRate: BN;
  reputation: DecodedReputationScore;
  jobsCompleted: BN;
  jobsDisputed: number;
  stakeAmount: BN;
  status: AgentStatusEnum;
  version: number;
  registeredAt: BN;
  lastActive: BN;
  delegate: PublicKey | null;
  pendingSlash: { amount: BN; reason: number; initiatedAt: BN } | null;
  pendingWithdrawal: { amount: BN; requestedAt: BN } | null;
  bump: number;
  vaultBump: number;
}

export interface DecodedPaymentStream {
  agentDid: number[];
  client: PublicKey;
  payerMint: PublicKey;
  payoutMint: PublicKey;
  ratePerSec: BN;
  startTime: BN;
  maxDuration: BN;
  depositTotal: BN;
  withdrawn: BN;
  status: StreamStatusEnum;
  streamNonce: number[];
}

export interface DecodedSwapExact {
  inMint: PublicKey;
  outMint: PublicKey;
  amountIn: BN;
  minOut: BN;
}

export interface DecodedTransfer {
  mint: PublicKey;
  to: PublicKey;
  amount: BN;
}

export interface DecodedDataFetch {
  urlHash: number[];
  expectedHash: number[];
}

export interface DecodedCompute {
  circuitId: number[];
  publicInputsHash: number[];
}

export interface DecodedGeneric {
  capabilityBit: number;
  argsHash: number[];
}

export type DecodedTaskPayloadKind =
  | { swapExact: DecodedSwapExact }
  | { transfer: DecodedTransfer }
  | { dataFetch: DecodedDataFetch }
  | { compute: DecodedCompute }
  | { generic: DecodedGeneric };

export interface DecodedTaskPayload {
  kind: DecodedTaskPayloadKind;
  capabilityBit: number;
  criteria: number[];
}

export interface DecodedTaskContract {
  taskId: number[];
  client: PublicKey;
  agentDid: number[];
  taskNonce: number[];
  paymentMint: PublicKey;
  paymentAmount: BN;
  status: TaskStatusEnum;
  deadline: BN;
  verified: boolean;
  createdAt: BN;
  taskHash: number[];
  resultHash: number[];
  proofKey: number[];
  criteriaRoot: number[];
  protocolFee: BN;
  solrepFee: BN;
  milestoneCount: number;
  milestonesComplete: number;
  fundedAt: BN;
  submittedAt: BN;
  disputeWindowEnd: BN;
  payload: DecodedTaskPayload;
}

export interface DecodedBidBook {
  taskId: number[];
  commitStart: BN;
  commitEnd: BN;
  revealEnd: BN;
  bondAmount: BN;
  bondMint: PublicKey;
  commitCount: number;
  revealCount: number;
  winnerAgent: PublicKey | null;
  winnerBidder: PublicKey | null;
  winnerAmount: BN;
  phase: BidPhaseEnum;
}

export interface DecodedBid {
  taskId: number[];
  agentDid: number[];
  bidder: PublicKey;
  commitHash: number[];
  bondPaid: BN;
  revealedAmount: BN;
  revealed: boolean;
  refunded: boolean;
  slashed: boolean;
}

export interface DecodedVerifierConfig {
  authority: PublicKey;
  activeVk: PublicKey;
  pendingVk: PublicKey | null;
  pendingActivatesAt: BN;
  paused: boolean;
}

export interface DecodedVerifierKey {
  vkId: number[];
  circuitLabel: number[];
  isProduction: boolean;
  numPublicInputs: number;
  registeredAt: BN;
  registeredBy: PublicKey;
}

export interface DecodedCategoryReputation {
  agentDid: number[];
  capabilityBit: number;
  score: DecodedReputationScore;
  jobsCompleted: number;
  jobsDisputed: number;
  lastProofKey: number[];
  lastTaskId: number[];
  version: number;
}

export interface DecodedRegistryConfig {
  authority: PublicKey;
  approvedMask: BN;
  tagCount: number;
  paused: boolean;
}

export interface DecodedProposal {
  proposalId: BN;
  proposer: PublicKey;
  category: ProposalCategoryEnum;
  targetProgram: PublicKey;
  metadataUri: number[];
  status: ProposalStatusEnum;
  createdAt: BN;
  voteStart: BN;
  voteEnd: BN;
  forWeight: BN;
  againstWeight: BN;
  abstainWeight: BN;
  totalEligibleWeight: BN;
  snapshotSlot: BN;
  snapshotRoot: number[];
}
