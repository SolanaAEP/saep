import { Program, BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import type { AgentRegistry } from '../generated/agent_registry.js';
import type { TreasuryStandard } from '../generated/treasury_standard.js';
import type { TaskMarket } from '../generated/task_market.js';
import type { ProofVerifier } from '../generated/proof_verifier.js';
import type { CapabilityRegistry } from '../generated/capability_registry.js';
import { agentAccountPda, treasuryPda, taskPda, verifierConfigPda, verifierKeyPda, capabilityConfigPda } from '../pda/index.js';

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
