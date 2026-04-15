import { Program, BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import type { AgentRegistry } from '../generated/agent_registry.js';
import type { TreasuryStandard } from '../generated/treasury_standard.js';
import { agentAccountPda, treasuryPda } from '../pda/index.js';

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
