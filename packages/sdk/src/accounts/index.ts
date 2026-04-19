import { Program, BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import type { AgentRegistry } from '../generated/agent_registry.js';
import type { TreasuryStandard } from '../generated/treasury_standard.js';
import type { TaskMarket } from '../generated/task_market.js';
import type { ProofVerifier } from '../generated/proof_verifier.js';
import type { CapabilityRegistry } from '../generated/capability_registry.js';
import { agentAccountPda, treasuryPda, taskPda, verifierConfigPda, verifierKeyPda, capabilityConfigPda, treasuryAllowedMintsPda, vaultPda, bidBookPda, bidPda, categoryReputationPda } from '../pda/index.js';
import type {
  AnchorEnum,
  AgentStatusEnum,
  StreamStatusEnum,
  TaskStatusEnum,
  BidPhaseEnum,
  DecodedAgentAccount,
  DecodedPaymentStream,
  DecodedTaskContract,
  DecodedTaskPayload as DecodedTaskPayloadRaw,
  DecodedBidBook,
  DecodedBid,
  DecodedVerifierConfig,
  DecodedVerifierKey,
  DecodedCategoryReputation,
  DecodedRegistryConfig,
  DecodedReputationScore,
} from './anchor-decoded.js';

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

const statusFromEnum = (s: AnchorEnum): AgentSummary['status'] => {
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
  return accounts.map(({ publicKey, account }) => {
    const a = account as DecodedAgentAccount;
    return toAgentSummary(publicKey, a);
  });
}

function toAgentSummary(address: PublicKey, a: DecodedAgentAccount): AgentSummary {
  return {
    address,
    operator: a.operator,
    agentId: Uint8Array.from(a.agentId),
    did: Uint8Array.from(a.did),
    manifestUri: decodeUri(a.manifestUri),
    capabilityMask: BigInt(a.capabilityMask.toString()),
    priceLamports: BigInt(a.priceLamports.toString()),
    streamRate: BigInt(a.streamRate.toString()),
    stakeAmount: BigInt(a.stakeAmount.toString()),
    status: statusFromEnum(a.status),
    jobsCompleted: BigInt(a.jobsCompleted.toString()),
    registeredAt: a.registeredAt.toNumber(),
  };
}

export async function fetchAgent(
  program: Program<AgentRegistry>,
  operator: PublicKey,
  agentId: Uint8Array,
): Promise<AgentSummary | null> {
  const [addr] = agentAccountPda(program.programId, operator, agentId);
  const raw = await program.account.agentAccount.fetchNullable(addr);
  if (!raw) return null;
  const a = raw as DecodedAgentAccount;
  return toAgentSummary(addr, a);
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

const streamStatusFromEnum = (s: AnchorEnum): StreamSummary['status'] => {
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
  return accounts.map(({ publicKey, account }) => {
    const s = account as DecodedPaymentStream;
    return {
      address: publicKey,
      agentDid: Uint8Array.from(s.agentDid),
      client: s.client,
      payerMint: s.payerMint,
      payoutMint: s.payoutMint,
      ratePerSec: BigInt(s.ratePerSec.toString()),
      startTime: s.startTime.toNumber(),
      maxDuration: s.maxDuration.toNumber(),
      depositTotal: BigInt(s.depositTotal.toString()),
      withdrawn: BigInt(s.withdrawn.toString()),
      status: streamStatusFromEnum(s.status),
      streamNonce: Uint8Array.from(s.streamNonce),
    };
  });
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

const taskStatusFromEnum = (s: AnchorEnum): string => {
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
  const t = raw as DecodedTaskContract;
  return toTaskSummary(addr, t);
}

function toTaskSummary(address: PublicKey, t: DecodedTaskContract): TaskSummary {
  return {
    address,
    taskId: Uint8Array.from(t.taskId),
    client: t.client,
    agentDid: Uint8Array.from(t.agentDid),
    taskNonce: Uint8Array.from(t.taskNonce),
    paymentMint: t.paymentMint,
    paymentAmount: BigInt(t.paymentAmount.toString()),
    status: taskStatusFromEnum(t.status),
    deadline: t.deadline.toNumber(),
    verified: t.verified,
    createdAt: t.createdAt.toNumber(),
  };
}

export async function fetchTasksByClient(
  program: Program<TaskMarket>,
  client: PublicKey,
): Promise<TaskSummary[]> {
  const accounts = await program.account.taskContract.all([
    { memcmp: { offset: 8 + 32, bytes: client.toBase58() } },
  ]);
  return accounts.map(({ publicKey, account }) => toTaskSummary(publicKey, account as DecodedTaskContract));
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

const decodeTaskPayload = (raw: DecodedTaskPayloadRaw): TaskPayload => {
  const kindRaw = raw.kind;
  let kind: TaskPayloadKind;
  if ('swapExact' in kindRaw) {
    const k = kindRaw.swapExact!;
    kind = {
      type: 'swapExact',
      inMint: k.inMint,
      outMint: k.outMint,
      amountIn: BigInt(k.amountIn.toString()),
      minOut: BigInt(k.minOut.toString()),
    };
  } else if ('transfer' in kindRaw) {
    const k = kindRaw.transfer!;
    kind = {
      type: 'transfer',
      mint: k.mint,
      to: k.to,
      amount: BigInt(k.amount.toString()),
    };
  } else if ('dataFetch' in kindRaw) {
    const k = kindRaw.dataFetch!;
    kind = {
      type: 'dataFetch',
      urlHash: Uint8Array.from(k.urlHash),
      expectedHash: Uint8Array.from(k.expectedHash),
    };
  } else if ('compute' in kindRaw) {
    const k = kindRaw.compute!;
    kind = {
      type: 'compute',
      circuitId: Uint8Array.from(k.circuitId),
      publicInputsHash: Uint8Array.from(k.publicInputsHash),
    };
  } else {
    const k = (kindRaw as Extract<typeof kindRaw, { generic: unknown }>).generic;
    kind = {
      type: 'generic',
      capabilityBit: k.capabilityBit,
      argsHash: Uint8Array.from(k.argsHash),
    };
  }
  return {
    kind,
    capabilityBit: raw.capabilityBit,
    criteria: Uint8Array.from(raw.criteria),
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

const toTaskDetail = (address: PublicKey, raw: DecodedTaskContract): TaskDetail => ({
  address,
  taskId: Uint8Array.from(raw.taskId),
  client: raw.client,
  agentDid: Uint8Array.from(raw.agentDid),
  taskNonce: Uint8Array.from(raw.taskNonce),
  paymentMint: raw.paymentMint,
  paymentAmount: BigInt(raw.paymentAmount.toString()),
  status: taskStatusFromEnum(raw.status),
  deadline: raw.deadline.toNumber(),
  verified: raw.verified,
  createdAt: raw.createdAt.toNumber(),
  taskHash: Uint8Array.from(raw.taskHash),
  resultHash: Uint8Array.from(raw.resultHash),
  proofKey: Uint8Array.from(raw.proofKey),
  criteriaRoot: Uint8Array.from(raw.criteriaRoot),
  protocolFee: BigInt(raw.protocolFee.toString()),
  solrepFee: BigInt(raw.solrepFee.toString()),
  milestoneCount: raw.milestoneCount,
  milestonesComplete: raw.milestonesComplete,
  fundedAt: raw.fundedAt.toNumber(),
  submittedAt: raw.submittedAt.toNumber(),
  disputeWindowEnd: raw.disputeWindowEnd.toNumber(),
  payload: decodeTaskPayload(raw.payload),
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
  return toTaskDetail(first.publicKey, first.account as DecodedTaskContract);
}

// bid_book / bid fetchers

export type BidPhase = 'commit' | 'reveal' | 'settled' | 'cancelled';

const bidPhaseFromEnum = (s: AnchorEnum): BidPhase => {
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
  const raw = (await program.account.bidBook.fetchNullable(addr)) as DecodedBidBook | null;
  if (!raw) return null;
  return {
    address: addr,
    taskId: Uint8Array.from(raw.taskId),
    commitStart: raw.commitStart.toNumber(),
    commitEnd: raw.commitEnd.toNumber(),
    revealEnd: raw.revealEnd.toNumber(),
    bondAmount: BigInt(raw.bondAmount.toString()),
    bondMint: raw.bondMint,
    commitCount: raw.commitCount,
    revealCount: raw.revealCount,
    winnerAgent: raw.winnerAgent ?? null,
    winnerBidder: raw.winnerBidder ?? null,
    winnerAmount: BigInt(raw.winnerAmount.toString()),
    phase: bidPhaseFromEnum(raw.phase),
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

const toBidSummary = (address: PublicKey, raw: DecodedBid): BidSummary => ({
  address,
  taskId: Uint8Array.from(raw.taskId),
  agentDid: Uint8Array.from(raw.agentDid),
  bidder: raw.bidder,
  commitHash: Uint8Array.from(raw.commitHash),
  bondPaid: BigInt(raw.bondPaid.toString()),
  revealedAmount: BigInt(raw.revealedAmount.toString()),
  revealed: raw.revealed,
  refunded: raw.refunded,
  slashed: raw.slashed,
});

export async function fetchBid(
  program: Program<TaskMarket>,
  taskId: Uint8Array,
  bidder: PublicKey,
): Promise<BidSummary | null> {
  const [addr] = bidPda(program.programId, taskId, bidder);
  const raw = (await program.account.bid.fetchNullable(addr)) as DecodedBid | null;
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
    toBidSummary(publicKey, account as DecodedBid),
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
  const vc = raw as DecodedVerifierConfig;
  return {
    address: addr,
    authority: vc.authority,
    activeVk: vc.activeVk,
    pendingVk: vc.pendingVk ?? null,
    pendingActivatesAt: vc.pendingActivatesAt.toNumber(),
    paused: vc.paused,
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
  const vk = raw as DecodedVerifierKey;
  return {
    address: addr,
    vkId: Uint8Array.from(vk.vkId),
    circuitLabel: Uint8Array.from(vk.circuitLabel),
    isProduction: vk.isProduction,
    numPublicInputs: vk.numPublicInputs,
    registeredAt: vk.registeredAt.toNumber(),
    registeredBy: vk.registeredBy,
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

const toDetail = (address: PublicKey, raw: DecodedAgentAccount): AgentDetail => {
  const rep = raw.reputation;
  return {
    address,
    operator: raw.operator,
    agentId: Uint8Array.from(raw.agentId),
    did: Uint8Array.from(raw.did),
    manifestUri: decodeUri(raw.manifestUri),
    capabilityMask: BigInt(raw.capabilityMask.toString()),
    priceLamports: BigInt(raw.priceLamports.toString()),
    streamRate: BigInt(raw.streamRate.toString()),
    stakeAmount: BigInt(raw.stakeAmount.toString()),
    status: statusFromEnum(raw.status),
    jobsCompleted: BigInt(raw.jobsCompleted.toString()),
    registeredAt: raw.registeredAt.toNumber(),
    reputation: {
      quality: rep.quality,
      timeliness: rep.timeliness,
      availability: rep.availability,
      costEfficiency: rep.costEfficiency,
      honesty: rep.honesty,
      volume: rep.volume,
      sampleCount: rep.sampleCount,
      lastUpdate: rep.lastUpdate.toNumber(),
    },
    jobsDisputed: raw.jobsDisputed,
    version: raw.version,
    lastActive: raw.lastActive.toNumber(),
    delegate: raw.delegate ?? null,
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
  return toDetail(first.publicKey, first.account as DecodedAgentAccount);
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
  return accounts.map(({ publicKey, account }) => toTaskSummary(publicKey, account as DecodedTaskContract));
}

// all agents (marketplace)

export async function fetchAllAgents(
  program: Program<AgentRegistry>,
): Promise<AgentSummary[]> {
  const accounts = await program.account.agentAccount.all();
  return accounts.map(({ publicKey, account }) => toAgentSummary(publicKey, account as DecodedAgentAccount));
}

export async function fetchAllAgentsDetailed(
  program: Program<AgentRegistry>,
): Promise<AgentDetail[]> {
  const accounts = await program.account.agentAccount.all();
  return accounts.map(({ publicKey, account }) =>
    toDetail(publicKey, account as DecodedAgentAccount),
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
  raw: DecodedCategoryReputation,
): CategoryReputationSummary => {
  const score = raw.score;
  return {
    address,
    agentDid: Uint8Array.from(raw.agentDid),
    capabilityBit: raw.capabilityBit,
    quality: score.quality,
    timeliness: score.timeliness,
    availability: score.availability,
    costEfficiency: score.costEfficiency,
    honesty: score.honesty,
    volume: score.volume,
    sampleCount: score.sampleCount,
    lastUpdate: score.lastUpdate.toNumber(),
    jobsCompleted: raw.jobsCompleted,
    jobsDisputed: raw.jobsDisputed,
    lastProofKey: Uint8Array.from(raw.lastProofKey),
    lastTaskId: Uint8Array.from(raw.lastTaskId),
    version: raw.version,
  };
};

export async function fetchCategoryReputation(
  program: Program<AgentRegistry>,
  agentDid: Uint8Array,
  capabilityBit: number,
): Promise<CategoryReputationSummary | null> {
  const [addr] = categoryReputationPda(program.programId, agentDid, capabilityBit);
  const raw = (await program.account.categoryReputation.fetchNullable(addr)) as DecodedCategoryReputation | null;
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
    toCategoryRep(publicKey, account as DecodedCategoryReputation),
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
  const rc = raw as DecodedRegistryConfig;
  return {
    address: addr,
    authority: rc.authority,
    approvedMask: BigInt(rc.approvedMask.toString()),
    tagCount: rc.tagCount,
    paused: rc.paused,
  };
}

export type {
  AnchorEnum,
  AgentStatusEnum,
  StreamStatusEnum,
  TaskStatusEnum,
  BidPhaseEnum,
  DecodedAgentAccount,
  DecodedPaymentStream,
  DecodedTaskContract,
  DecodedBidBook,
  DecodedBid,
  DecodedVerifierConfig,
  DecodedVerifierKey,
  DecodedCategoryReputation,
  DecodedRegistryConfig,
  DecodedReputationScore,
  ProposalCategoryEnum,
  ProposalStatusEnum,
  DecodedProposal,
} from './anchor-decoded.js';
