import { Program, BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import type { AgentRegistry } from '../generated/agent_registry.js';
import type { TreasuryStandard } from '../generated/treasury_standard.js';
import type { TaskMarket } from '../generated/task_market.js';
import type { ProofVerifier } from '../generated/proof_verifier.js';
import type { CapabilityRegistry } from '../generated/capability_registry.js';
import { agentAccountPda, treasuryPda, taskPda, verifierConfigPda, verifierKeyPda, capabilityConfigPda, treasuryAllowedMintsPda, vaultPda, bidBookPda, bidPda, categoryReputationPda } from '../pda/index.js';

export interface AgentSummary {
  address: PublicKey;
  operator: PublicKey;
  agentId: Uint8Array;
  did: Uint8Array;
  manifestUri: string;
  capabilityMask: bigint;
  priceLamports: bigint;
  streamRate: bigint;
  stakeAmount: bigint;
  status: 'active' | 'paused' | 'suspended' | 'deregistered';
  jobsCompleted: bigint;
  registeredAt: number;
}

const decodeUri = (bytes: number[]): string => {
  const end = bytes.findIndex((b) => b === 0);
  const slice = end === -1 ? bytes : bytes.slice(0, end);
  return new TextDecoder().decode(Uint8Array.from(slice));
};

const statusFromEnum = (s: Record<string, unknown>): AgentSummary['status'] => {
  if ('active' in s) return 'active';
  if ('paused' in s) return 'paused';
  if ('suspended' in s) return 'suspended';
  return 'deregistered';
};

export async function fetchAgentsByOperator(
  program: Program<AgentRegistry>,
  operator: PublicKey,
): Promise<AgentSummary[]> {
  const accounts = await program.account.agentAccount.all([
    { memcmp: { offset: 8, bytes: operator.toBase58() } },
  ]);
  return accounts.map(({ publicKey, account }) => ({
    address: publicKey,
    operator: account.operator,
    agentId: Uint8Array.from(account.agentId as number[]),
    did: Uint8Array.from(account.did as number[]),
    manifestUri: decodeUri(account.manifestUri as number[]),
    capabilityMask: BigInt((account.capabilityMask as BN).toString()),
    priceLamports: BigInt((account.priceLamports as BN).toString()),
    streamRate: BigInt((account.streamRate as BN).toString()),
    stakeAmount: BigInt((account.stakeAmount as BN).toString()),
    status: statusFromEnum(account.status as Record<string, unknown>),
    jobsCompleted: BigInt((account.jobsCompleted as BN).toString()),
    registeredAt: (account.registeredAt as BN).toNumber(),
  }));
}

export async function fetchAgent(
  program: Program<AgentRegistry>,
  operator: PublicKey,
  agentId: Uint8Array,
): Promise<AgentSummary | null> {
  const [addr] = agentAccountPda(program.programId, operator, agentId);
  const raw = await program.account.agentAccount.fetchNullable(addr);
  if (!raw) return null;
  return {
    address: addr,
    operator: raw.operator,
    agentId: Uint8Array.from(raw.agentId as number[]),
    did: Uint8Array.from(raw.did as number[]),
    manifestUri: decodeUri(raw.manifestUri as number[]),
    capabilityMask: BigInt((raw.capabilityMask as BN).toString()),
    priceLamports: BigInt((raw.priceLamports as BN).toString()),
    streamRate: BigInt((raw.streamRate as BN).toString()),
    stakeAmount: BigInt((raw.stakeAmount as BN).toString()),
    status: statusFromEnum(raw.status as Record<string, unknown>),
    jobsCompleted: BigInt((raw.jobsCompleted as BN).toString()),
    registeredAt: (raw.registeredAt as BN).toNumber(),
  };
}

export interface TreasurySummary {
  address: PublicKey;
  agentDid: Uint8Array;
  operator: PublicKey;
  dailySpendLimit: bigint;
  perTxLimit: bigint;
  weeklyLimit: bigint;
  spentToday: bigint;
  spentThisWeek: bigint;
  streamingActive: boolean;
}

export async function fetchTreasury(
  program: Program<TreasuryStandard>,
  agentDid: Uint8Array,
): Promise<TreasurySummary | null> {
  const [addr] = treasuryPda(program.programId, agentDid);
  const raw = (await program.account.agentTreasury.fetchNullable(addr)) as
    | {
        agentDid: number[];
        operator: PublicKey;
        dailySpendLimit: BN;
        perTxLimit: BN;
        weeklyLimit: BN;
        spentToday: BN;
        spentThisWeek: BN;
        streamingActive: boolean;
      }
    | null;
  if (!raw) return null;
  return {
    address: addr,
    agentDid: Uint8Array.from(raw.agentDid),
    operator: raw.operator,
    dailySpendLimit: BigInt(raw.dailySpendLimit.toString()),
    perTxLimit: BigInt(raw.perTxLimit.toString()),
    weeklyLimit: BigInt(raw.weeklyLimit.toString()),
    spentToday: BigInt(raw.spentToday.toString()),
    spentThisWeek: BigInt(raw.spentThisWeek.toString()),
    streamingActive: raw.streamingActive,
  };
}

const streamStatusFromEnum = (s: Record<string, unknown>): StreamSummary['status'] => {
  if ('active' in s) return 'active';
  if ('paused' in s) return 'paused';
  if ('closed' in s) return 'closed';
  return 'expired';
};

export interface StreamSummary {
  address: PublicKey;
  agentDid: Uint8Array;
  client: PublicKey;
  payerMint: PublicKey;
  payoutMint: PublicKey;
  ratePerSec: bigint;
  startTime: number;
  maxDuration: number;
  depositTotal: bigint;
  withdrawn: bigint;
  status: 'active' | 'paused' | 'closed' | 'expired';
  streamNonce: Uint8Array;
}

export async function fetchStreamsByAgent(
  program: Program<TreasuryStandard>,
  agentDid: Uint8Array,
): Promise<StreamSummary[]> {
  const didKey = new PublicKey(agentDid);
  const accounts = await program.account.paymentStream.all([
    { memcmp: { offset: 8, bytes: didKey.toBase58() } },
  ]);
  return accounts.map(({ publicKey, account }) => ({
    address: publicKey,
    agentDid: Uint8Array.from(account.agentDid as number[]),
    client: account.client as PublicKey,
    payerMint: account.payerMint as PublicKey,
    payoutMint: account.payoutMint as PublicKey,
    ratePerSec: BigInt((account.ratePerSec as BN).toString()),
    startTime: (account.startTime as BN).toNumber(),
    maxDuration: (account.maxDuration as BN).toNumber(),
    depositTotal: BigInt((account.depositTotal as BN).toString()),
    withdrawn: BigInt((account.withdrawn as BN).toString()),
    status: streamStatusFromEnum(account.status as Record<string, unknown>),
    streamNonce: Uint8Array.from(account.streamNonce as number[]),
  }));
}

export async function fetchAllowedMints(
  program: Program<TreasuryStandard>,
): Promise<PublicKey[]> {
  const [addr] = treasuryAllowedMintsPda(program.programId);
  const raw = await program.account.allowedMints.fetchNullable(addr);
  if (!raw) return [];
  return raw.mints as PublicKey[];
}

export interface VaultBalance {
  mint: PublicKey;
  vault: PublicKey;
  amount: bigint;
  exists: boolean;
}

export async function fetchVaultBalances(
  program: Program<TreasuryStandard>,
  agentDid: Uint8Array,
  mints: PublicKey[],
): Promise<VaultBalance[]> {
  const conn = program.provider.connection;
  const vaults = mints.map((mint) => ({ mint, vault: vaultPda(program.programId, agentDid, mint)[0] }));
  const infos = await conn.getMultipleAccountsInfo(vaults.map((v) => v.vault));
  return vaults.map(({ mint, vault }, i) => {
    const info = infos[i];
    if (!info || info.data.length < 72) {
      return { mint, vault, amount: 0n, exists: false };
    }
    const amount = info.data.readBigUInt64LE(64);
    return { mint, vault, amount, exists: true };
  });
}

// task_market fetchers

const taskStatusFromEnum = (s: Record<string, unknown>): string => {
  if ('created' in s) return 'created';
  if ('funded' in s) return 'funded';
  if ('inExecution' in s) return 'inExecution';
  if ('proofSubmitted' in s) return 'proofSubmitted';
  if ('verified' in s) return 'verified';
  if ('released' in s) return 'released';
  if ('expired' in s) return 'expired';
  if ('disputed' in s) return 'disputed';
  return 'resolved';
};

export interface TaskSummary {
  address: PublicKey;
  taskId: Uint8Array;
  client: PublicKey;
  agentDid: Uint8Array;
  taskNonce: Uint8Array;
  paymentMint: PublicKey;
  paymentAmount: bigint;
  status: string;
  deadline: number;
  verified: boolean;
  createdAt: number;
}

export async function fetchTask(
  program: Program<TaskMarket>,
  client: PublicKey,
  taskNonce: Uint8Array,
): Promise<TaskSummary | null> {
  const [addr] = taskPda(program.programId, client, taskNonce);
  const raw = await program.account.taskContract.fetchNullable(addr);
  if (!raw) return null;
  return {
    address: addr,
    taskId: Uint8Array.from(raw.taskId as number[]),
    client: raw.client,
    agentDid: Uint8Array.from(raw.agentDid as number[]),
    taskNonce: Uint8Array.from(raw.taskNonce as number[]),
    paymentMint: raw.paymentMint,
    paymentAmount: BigInt((raw.paymentAmount as BN).toString()),
    status: taskStatusFromEnum(raw.status as Record<string, unknown>),
    deadline: (raw.deadline as BN).toNumber(),
    verified: raw.verified as boolean,
    createdAt: (raw.createdAt as BN).toNumber(),
  };
}

export async function fetchTasksByClient(
  program: Program<TaskMarket>,
  client: PublicKey,
): Promise<TaskSummary[]> {
  const accounts = await program.account.taskContract.all([
    { memcmp: { offset: 8 + 32, bytes: client.toBase58() } },
  ]);
  return accounts.map(({ publicKey, account }) => ({
    address: publicKey,
    taskId: Uint8Array.from(account.taskId as number[]),
    client: account.client,
    agentDid: Uint8Array.from(account.agentDid as number[]),
    taskNonce: Uint8Array.from(account.taskNonce as number[]),
    paymentMint: account.paymentMint,
    paymentAmount: BigInt((account.paymentAmount as BN).toString()),
    status: taskStatusFromEnum(account.status as Record<string, unknown>),
    deadline: (account.deadline as BN).toNumber(),
    verified: account.verified as boolean,
    createdAt: (account.createdAt as BN).toNumber(),
  }));
}

export type TaskPayloadKind =
  | {
      type: 'swapExact';
      inMint: PublicKey;
      outMint: PublicKey;
      amountIn: bigint;
      minOut: bigint;
    }
  | { type: 'transfer'; mint: PublicKey; to: PublicKey; amount: bigint }
  | { type: 'dataFetch'; urlHash: Uint8Array; expectedHash: Uint8Array }
  | { type: 'compute'; circuitId: Uint8Array; publicInputsHash: Uint8Array }
  | { type: 'generic'; capabilityBit: number; argsHash: Uint8Array };

export interface TaskPayload {
  kind: TaskPayloadKind;
  capabilityBit: number;
  criteria: Uint8Array;
}

const decodeTaskPayload = (raw: Record<string, unknown>): TaskPayload => {
  const kindRaw = raw.kind as Record<string, unknown>;
  let kind: TaskPayloadKind;
  if ('swapExact' in kindRaw) {
    const k = kindRaw.swapExact as Record<string, unknown>;
    kind = {
      type: 'swapExact',
      inMint: k.inMint as PublicKey,
      outMint: k.outMint as PublicKey,
      amountIn: BigInt((k.amountIn as BN).toString()),
      minOut: BigInt((k.minOut as BN).toString()),
    };
  } else if ('transfer' in kindRaw) {
    const k = kindRaw.transfer as Record<string, unknown>;
    kind = {
      type: 'transfer',
      mint: k.mint as PublicKey,
      to: k.to as PublicKey,
      amount: BigInt((k.amount as BN).toString()),
    };
  } else if ('dataFetch' in kindRaw) {
    const k = kindRaw.dataFetch as Record<string, unknown>;
    kind = {
      type: 'dataFetch',
      urlHash: Uint8Array.from(k.urlHash as number[]),
      expectedHash: Uint8Array.from(k.expectedHash as number[]),
    };
  } else if ('compute' in kindRaw) {
    const k = kindRaw.compute as Record<string, unknown>;
    kind = {
      type: 'compute',
      circuitId: Uint8Array.from(k.circuitId as number[]),
      publicInputsHash: Uint8Array.from(k.publicInputsHash as number[]),
    };
  } else {
    const k = kindRaw.generic as Record<string, unknown>;
    kind = {
      type: 'generic',
      capabilityBit: k.capabilityBit as number,
      argsHash: Uint8Array.from(k.argsHash as number[]),
    };
  }
  return {
    kind,
    capabilityBit: raw.capabilityBit as number,
    criteria: Uint8Array.from(raw.criteria as number[]),
  };
};

export interface TaskDetail extends TaskSummary {
  taskHash: Uint8Array;
  resultHash: Uint8Array;
  proofKey: Uint8Array;
  criteriaRoot: Uint8Array;
  protocolFee: bigint;
  solrepFee: bigint;
  milestoneCount: number;
  milestonesComplete: number;
  fundedAt: number;
  submittedAt: number;
  disputeWindowEnd: number;
  payload: TaskPayload;
}

const toTaskDetail = (address: PublicKey, raw: Record<string, unknown>): TaskDetail => ({
  address,
  taskId: Uint8Array.from(raw.taskId as number[]),
  client: raw.client as PublicKey,
  agentDid: Uint8Array.from(raw.agentDid as number[]),
  taskNonce: Uint8Array.from(raw.taskNonce as number[]),
  paymentMint: raw.paymentMint as PublicKey,
  paymentAmount: BigInt((raw.paymentAmount as BN).toString()),
  status: taskStatusFromEnum(raw.status as Record<string, unknown>),
  deadline: (raw.deadline as BN).toNumber(),
  verified: raw.verified as boolean,
  createdAt: (raw.createdAt as BN).toNumber(),
  taskHash: Uint8Array.from(raw.taskHash as number[]),
  resultHash: Uint8Array.from(raw.resultHash as number[]),
  proofKey: Uint8Array.from(raw.proofKey as number[]),
  criteriaRoot: Uint8Array.from(raw.criteriaRoot as number[]),
  protocolFee: BigInt((raw.protocolFee as BN).toString()),
  solrepFee: BigInt((raw.solrepFee as BN).toString()),
  milestoneCount: raw.milestoneCount as number,
  milestonesComplete: raw.milestonesComplete as number,
  fundedAt: (raw.fundedAt as BN).toNumber(),
  submittedAt: (raw.submittedAt as BN).toNumber(),
  disputeWindowEnd: (raw.disputeWindowEnd as BN).toNumber(),
  payload: decodeTaskPayload(raw.payload as Record<string, unknown>),
});

export async function fetchTaskById(
  program: Program<TaskMarket>,
  taskIdHex: string,
): Promise<TaskDetail | null> {
  const bytes = Uint8Array.from(
    taskIdHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)),
  );
  const key = new PublicKey(bytes);
  const accounts = await program.account.taskContract.all([
    { memcmp: { offset: 8, bytes: key.toBase58() } },
  ]);
  const first = accounts[0];
  if (!first) return null;
  return toTaskDetail(first.publicKey, first.account as unknown as Record<string, unknown>);
}

// bid_book / bid fetchers

export type BidPhase = 'commit' | 'reveal' | 'settled' | 'cancelled';

const bidPhaseFromEnum = (s: Record<string, unknown>): BidPhase => {
  if ('commit' in s) return 'commit';
  if ('reveal' in s) return 'reveal';
  if ('settled' in s) return 'settled';
  return 'cancelled';
};

export interface BidBookSummary {
  address: PublicKey;
  taskId: Uint8Array;
  commitStart: number;
  commitEnd: number;
  revealEnd: number;
  bondAmount: bigint;
  bondMint: PublicKey;
  commitCount: number;
  revealCount: number;
  winnerAgent: PublicKey | null;
  winnerBidder: PublicKey | null;
  winnerAmount: bigint;
  phase: BidPhase;
}

export async function fetchBidBook(
  program: Program<TaskMarket>,
  taskId: Uint8Array,
): Promise<BidBookSummary | null> {
  const [addr] = bidBookPda(program.programId, taskId);
  const raw = (await program.account.bidBook.fetchNullable(addr)) as
    | Record<string, unknown>
    | null;
  if (!raw) return null;
  return {
    address: addr,
    taskId: Uint8Array.from(raw.taskId as number[]),
    commitStart: (raw.commitStart as BN).toNumber(),
    commitEnd: (raw.commitEnd as BN).toNumber(),
    revealEnd: (raw.revealEnd as BN).toNumber(),
    bondAmount: BigInt((raw.bondAmount as BN).toString()),
    bondMint: raw.bondMint as PublicKey,
    commitCount: raw.commitCount as number,
    revealCount: raw.revealCount as number,
    winnerAgent: (raw.winnerAgent as PublicKey | null) ?? null,
    winnerBidder: (raw.winnerBidder as PublicKey | null) ?? null,
    winnerAmount: BigInt((raw.winnerAmount as BN).toString()),
    phase: bidPhaseFromEnum(raw.phase as Record<string, unknown>),
  };
}

export interface BidSummary {
  address: PublicKey;
  taskId: Uint8Array;
  agentDid: Uint8Array;
  bidder: PublicKey;
  commitHash: Uint8Array;
  bondPaid: bigint;
  revealedAmount: bigint;
  revealed: boolean;
  refunded: boolean;
  slashed: boolean;
}

const toBidSummary = (address: PublicKey, raw: Record<string, unknown>): BidSummary => ({
  address,
  taskId: Uint8Array.from(raw.taskId as number[]),
  agentDid: Uint8Array.from(raw.agentDid as number[]),
  bidder: raw.bidder as PublicKey,
  commitHash: Uint8Array.from(raw.commitHash as number[]),
  bondPaid: BigInt((raw.bondPaid as BN).toString()),
  revealedAmount: BigInt((raw.revealedAmount as BN).toString()),
  revealed: raw.revealed as boolean,
  refunded: raw.refunded as boolean,
  slashed: raw.slashed as boolean,
});

export async function fetchBid(
  program: Program<TaskMarket>,
  taskId: Uint8Array,
  bidder: PublicKey,
): Promise<BidSummary | null> {
  const [addr] = bidPda(program.programId, taskId, bidder);
  const raw = (await program.account.bid.fetchNullable(addr)) as
    | Record<string, unknown>
    | null;
  if (!raw) return null;
  return toBidSummary(addr, raw);
}

export async function fetchBidsForTask(
  program: Program<TaskMarket>,
  taskId: Uint8Array,
): Promise<BidSummary[]> {
  const taskIdKey = new PublicKey(taskId);
  const accounts = await program.account.bid.all([
    { memcmp: { offset: 8, bytes: taskIdKey.toBase58() } },
  ]);
  return accounts.map(({ publicKey, account }) =>
    toBidSummary(publicKey, account as unknown as Record<string, unknown>),
  );
}

// proof_verifier fetchers

export interface VerifierConfigSummary {
  address: PublicKey;
  authority: PublicKey;
  activeVk: PublicKey;
  pendingVk: PublicKey | null;
  pendingActivatesAt: number;
  paused: boolean;
}

export async function fetchVerifierConfig(
  program: Program<ProofVerifier>,
): Promise<VerifierConfigSummary | null> {
  const [addr] = verifierConfigPda(program.programId);
  const raw = await program.account.verifierConfig.fetchNullable(addr);
  if (!raw) return null;
  return {
    address: addr,
    authority: raw.authority,
    activeVk: raw.activeVk,
    pendingVk: (raw.pendingVk as PublicKey | null) ?? null,
    pendingActivatesAt: (raw.pendingActivatesAt as BN).toNumber(),
    paused: raw.paused as boolean,
  };
}

export interface VerifierKeySummary {
  address: PublicKey;
  vkId: Uint8Array;
  circuitLabel: Uint8Array;
  isProduction: boolean;
  numPublicInputs: number;
  registeredAt: number;
  registeredBy: PublicKey;
}

export async function fetchVerifierKey(
  program: Program<ProofVerifier>,
  vkId: Uint8Array,
): Promise<VerifierKeySummary | null> {
  const [addr] = verifierKeyPda(program.programId, vkId);
  const raw = await program.account.verifierKey.fetchNullable(addr);
  if (!raw) return null;
  return {
    address: addr,
    vkId: Uint8Array.from(raw.vkId as number[]),
    circuitLabel: Uint8Array.from(raw.circuitLabel as number[]),
    isProduction: raw.isProduction as boolean,
    numPublicInputs: raw.numPublicInputs as number,
    registeredAt: (raw.registeredAt as BN).toNumber(),
    registeredBy: raw.registeredBy,
  };
}

// agent detail (full reputation dims)

export interface ReputationDims {
  quality: number;
  timeliness: number;
  availability: number;
  costEfficiency: number;
  honesty: number;
  volume: number;
  sampleCount: number;
  lastUpdate: number;
}

export interface AgentDetail extends AgentSummary {
  reputation: ReputationDims;
  jobsDisputed: number;
  version: number;
  lastActive: number;
  delegate: PublicKey | null;
}

const toDetail = (address: PublicKey, raw: Record<string, unknown>): AgentDetail => {
  const rep = raw.reputation as Record<string, unknown>;
  return {
    address,
    operator: raw.operator as PublicKey,
    agentId: Uint8Array.from(raw.agentId as number[]),
    did: Uint8Array.from(raw.did as number[]),
    manifestUri: decodeUri(raw.manifestUri as number[]),
    capabilityMask: BigInt((raw.capabilityMask as BN).toString()),
    priceLamports: BigInt((raw.priceLamports as BN).toString()),
    streamRate: BigInt((raw.streamRate as BN).toString()),
    stakeAmount: BigInt((raw.stakeAmount as BN).toString()),
    status: statusFromEnum(raw.status as Record<string, unknown>),
    jobsCompleted: BigInt((raw.jobsCompleted as BN).toString()),
    registeredAt: (raw.registeredAt as BN).toNumber(),
    reputation: {
      quality: rep.quality as number,
      timeliness: rep.timeliness as number,
      availability: rep.availability as number,
      costEfficiency: rep.costEfficiency as number,
      honesty: rep.honesty as number,
      volume: rep.volume as number,
      sampleCount: rep.sampleCount as number,
      lastUpdate: (rep.lastUpdate as BN).toNumber(),
    },
    jobsDisputed: raw.jobsDisputed as number,
    version: raw.version as number,
    lastActive: (raw.lastActive as BN).toNumber(),
    delegate: (raw.delegate as PublicKey | null) ?? null,
  };
};

export async function fetchAgentByDid(
  program: Program<AgentRegistry>,
  didHex: string,
): Promise<AgentDetail | null> {
  const didBytes = Uint8Array.from(
    didHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)),
  );
  // did field offset: 8 (discriminator) + 32 (operator) + 32 (agentId) = 72
  const didKey = new PublicKey(didBytes);
  const accounts = await program.account.agentAccount.all([
    { memcmp: { offset: 72, bytes: didKey.toBase58() } },
  ]);
  const first = accounts[0];
  if (!first) return null;
  return toDetail(first.publicKey, first.account as unknown as Record<string, unknown>);
}

export async function fetchTasksByAgent(
  program: Program<TaskMarket>,
  didHex: string,
): Promise<TaskSummary[]> {
  const didBytes = Uint8Array.from(
    didHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)),
  );
  // agentDid field offset: 8 (discriminator) + 32 (taskId) + 32 (client) = 72
  const didKey = new PublicKey(didBytes);
  const accounts = await program.account.taskContract.all([
    { memcmp: { offset: 72, bytes: didKey.toBase58() } },
  ]);
  return accounts.map(({ publicKey, account }) => ({
    address: publicKey,
    taskId: Uint8Array.from(account.taskId as number[]),
    client: account.client,
    agentDid: Uint8Array.from(account.agentDid as number[]),
    taskNonce: Uint8Array.from(account.taskNonce as number[]),
    paymentMint: account.paymentMint,
    paymentAmount: BigInt((account.paymentAmount as BN).toString()),
    status: taskStatusFromEnum(account.status as Record<string, unknown>),
    deadline: (account.deadline as BN).toNumber(),
    verified: account.verified as boolean,
    createdAt: (account.createdAt as BN).toNumber(),
  }));
}

// all agents (marketplace)

export async function fetchAllAgents(
  program: Program<AgentRegistry>,
): Promise<AgentSummary[]> {
  const accounts = await program.account.agentAccount.all();
  return accounts.map(({ publicKey, account }) => ({
    address: publicKey,
    operator: account.operator,
    agentId: Uint8Array.from(account.agentId as number[]),
    did: Uint8Array.from(account.did as number[]),
    manifestUri: decodeUri(account.manifestUri as number[]),
    capabilityMask: BigInt((account.capabilityMask as BN).toString()),
    priceLamports: BigInt((account.priceLamports as BN).toString()),
    streamRate: BigInt((account.streamRate as BN).toString()),
    stakeAmount: BigInt((account.stakeAmount as BN).toString()),
    status: statusFromEnum(account.status as Record<string, unknown>),
    jobsCompleted: BigInt((account.jobsCompleted as BN).toString()),
    registeredAt: (account.registeredAt as BN).toNumber(),
  }));
}

export async function fetchAllAgentsDetailed(
  program: Program<AgentRegistry>,
): Promise<AgentDetail[]> {
  const accounts = await program.account.agentAccount.all();
  return accounts.map(({ publicKey, account }) =>
    toDetail(publicKey, account as unknown as Record<string, unknown>),
  );
}

// category reputation (proof-bound, per-capability)

export interface CategoryReputationSummary {
  address: PublicKey;
  agentDid: Uint8Array;
  capabilityBit: number;
  quality: number;
  timeliness: number;
  availability: number;
  costEfficiency: number;
  honesty: number;
  volume: number;
  sampleCount: number;
  lastUpdate: number;
  jobsCompleted: number;
  jobsDisputed: number;
  lastProofKey: Uint8Array;
  lastTaskId: Uint8Array;
  version: number;
}

const toCategoryRep = (
  address: PublicKey,
  raw: Record<string, unknown>,
): CategoryReputationSummary => {
  const score = raw.score as Record<string, unknown>;
  return {
    address,
    agentDid: Uint8Array.from(raw.agentDid as number[]),
    capabilityBit: raw.capabilityBit as number,
    quality: score.quality as number,
    timeliness: score.timeliness as number,
    availability: score.availability as number,
    costEfficiency: score.costEfficiency as number,
    honesty: score.honesty as number,
    volume: score.volume as number,
    sampleCount: score.sampleCount as number,
    lastUpdate: (score.lastUpdate as BN).toNumber(),
    jobsCompleted: raw.jobsCompleted as number,
    jobsDisputed: raw.jobsDisputed as number,
    lastProofKey: Uint8Array.from(raw.lastProofKey as number[]),
    lastTaskId: Uint8Array.from(raw.lastTaskId as number[]),
    version: raw.version as number,
  };
};

export async function fetchCategoryReputation(
  program: Program<AgentRegistry>,
  agentDid: Uint8Array,
  capabilityBit: number,
): Promise<CategoryReputationSummary | null> {
  const [addr] = categoryReputationPda(program.programId, agentDid, capabilityBit);
  const raw = (await program.account.categoryReputation.fetchNullable(addr)) as
    | Record<string, unknown>
    | null;
  if (!raw) return null;
  return toCategoryRep(addr, raw);
}

export async function fetchCategoryReputationsByAgent(
  program: Program<AgentRegistry>,
  agentDid: Uint8Array,
): Promise<CategoryReputationSummary[]> {
  const didKey = new PublicKey(agentDid);
  const accounts = await program.account.categoryReputation.all([
    { memcmp: { offset: 8, bytes: didKey.toBase58() } },
  ]);
  return accounts.map(({ publicKey, account }) =>
    toCategoryRep(publicKey, account as unknown as Record<string, unknown>),
  );
}

// capability_registry fetchers

export interface RegistryConfigSummary {
  address: PublicKey;
  authority: PublicKey;
  approvedMask: bigint;
  tagCount: number;
  paused: boolean;
}

export async function fetchRegistryConfig(
  program: Program<CapabilityRegistry>,
): Promise<RegistryConfigSummary | null> {
  const [addr] = capabilityConfigPda(program.programId);
  const raw = await program.account.registryConfig.fetchNullable(addr);
  if (!raw) return null;
  return {
    address: addr,
    authority: raw.authority,
    approvedMask: BigInt((raw.approvedMask as BN).toString()),
    tagCount: raw.tagCount as number,
    paused: raw.paused as boolean,
  };
}
