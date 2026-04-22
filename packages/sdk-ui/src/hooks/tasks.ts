'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PublicKey, Transaction } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  fetchMarketGlobal,
  fetchRecentTasks,
  fetchTaskById,
  fetchTasksByClient,
  buildRaiseDisputeIx,
} from '@saep/sdk';
import { useTaskMarketProgram } from './program.js';

export type DiscoveryComputeBondStatus =
  | 'reserved'
  | 'locked'
  | 'released'
  | 'slashed'
  | 'cancelled'
  | 'expired';

export type DiscoveryComputeBondProvider = 'ionet' | 'akash';

export interface DiscoveryComputeBondSummary {
  leaseId: string;
  agentDid: string;
  provider: DiscoveryComputeBondProvider;
  gpuHours: number;
  expiresAt: number;
  slashableUntil: number;
  taskId: string | null;
  status: DiscoveryComputeBondStatus;
  statusReason: string | null;
  reservedPriceUsdMicro: number | null;
  brokerPubkey: string;
  attestationSig: string;
  createdAtMs: number;
  updatedAtMs: number;
  providerStatus: string | null;
}

export interface IndexedTaskSummary {
  taskIdHex: string;
  creator: string | null;
  agentDidHex: string | null;
  status: string | null;
  rewardLamports: string | null;
  capabilityMask: string | null;
  createdAtUnix: number;
  deadlineUnix: number | null;
  updatedAtUnix: number | null;
  computeBonds: DiscoveryComputeBondSummary[];
}

interface RawDiscoveryComputeBondSummary {
  lease_id: string;
  agent_did: string;
  provider: DiscoveryComputeBondProvider;
  gpu_hours: number;
  expires_at: number;
  slashable_until: number;
  task_id: string | null;
  status: DiscoveryComputeBondStatus;
  status_reason: string | null;
  reserved_price_usd_micro: number | null;
  broker_pubkey: string;
  attestation_sig: string;
  created_at_ms: number;
  updated_at_ms: number;
  provider_status: string | null;
}

interface RawIndexedTaskSummary {
  task_id_hex?: string;
  task_id?: string;
  creator: string | null;
  agent_did_hex?: string | null;
  status: string | null;
  reward_lamports: string | null;
  capability_mask?: string | null;
  created_at_unix: number;
  deadline_unix: number | null;
  updated_at_unix: number | null;
  compute_bonds: RawDiscoveryComputeBondSummary[];
}

interface RawTaskBondsResponse {
  items: RawDiscoveryComputeBondSummary[];
}

async function fetchIndexerJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`indexer ${res.status}: ${body || res.statusText}`);
  }
  return (await res.json()) as T;
}

function mapComputeBond(raw: RawDiscoveryComputeBondSummary): DiscoveryComputeBondSummary {
  return {
    leaseId: raw.lease_id,
    agentDid: raw.agent_did,
    provider: raw.provider,
    gpuHours: raw.gpu_hours,
    expiresAt: raw.expires_at,
    slashableUntil: raw.slashable_until,
    taskId: raw.task_id,
    status: raw.status,
    statusReason: raw.status_reason,
    reservedPriceUsdMicro: raw.reserved_price_usd_micro,
    brokerPubkey: raw.broker_pubkey,
    attestationSig: raw.attestation_sig,
    createdAtMs: raw.created_at_ms,
    updatedAtMs: raw.updated_at_ms,
    providerStatus: raw.provider_status,
  };
}

function mapIndexedTask(raw: RawIndexedTaskSummary): IndexedTaskSummary {
  return {
    taskIdHex: raw.task_id_hex ?? raw.task_id ?? '',
    creator: raw.creator,
    agentDidHex: raw.agent_did_hex ?? null,
    status: raw.status,
    rewardLamports: raw.reward_lamports,
    capabilityMask: raw.capability_mask ?? null,
    createdAtUnix: raw.created_at_unix,
    deadlineUnix: raw.deadline_unix,
    updatedAtUnix: raw.updated_at_unix,
    computeBonds: raw.compute_bonds.map(mapComputeBond),
  };
}

export interface UseDiscoveryTasksArgs {
  indexerUrl: string;
  statuses?: string[];
  capability?: number;
  minReward?: string;
  page?: number;
  limit?: number;
  enabled?: boolean;
}

export interface UseDiscoveryAgentTasksArgs {
  indexerUrl: string;
  agentDidHex: string | null;
  statuses?: string[];
  page?: number;
  limit?: number;
  enabled?: boolean;
}

export interface UseTaskComputeBondsArgs {
  indexerUrl: string;
  taskIdHex: string | null;
  status?: DiscoveryComputeBondStatus;
  provider?: DiscoveryComputeBondProvider;
  limit?: number;
  enabled?: boolean;
}

function buildTasksUrl(baseUrl: string, args: UseDiscoveryTasksArgs): string {
  const params = new URLSearchParams();
  if (args.statuses && args.statuses.length > 0) params.set('status', args.statuses.join(','));
  if (args.capability != null) params.set('capability', String(args.capability));
  if (args.minReward) params.set('min_reward', args.minReward);
  params.set('page', String(args.page ?? 1));
  params.set('limit', String(args.limit ?? 20));
  return `${baseUrl.replace(/\/$/, '')}/tasks?${params.toString()}`;
}

function buildAgentTasksUrl(baseUrl: string, args: UseDiscoveryAgentTasksArgs): string {
  const params = new URLSearchParams();
  if (args.statuses && args.statuses.length > 0) params.set('status', args.statuses.join(','));
  params.set('page', String(args.page ?? 1));
  params.set('limit', String(args.limit ?? 50));
  return `${baseUrl.replace(/\/$/, '')}/agents/${args.agentDidHex}/tasks?${params.toString()}`;
}

function buildTaskComputeBondsUrl(baseUrl: string, args: UseTaskComputeBondsArgs): string {
  const params = new URLSearchParams();
  if (args.status) params.set('status', args.status);
  if (args.provider) params.set('provider', args.provider);
  params.set('limit', String(args.limit ?? 50));
  return `${baseUrl.replace(/\/$/, '')}/tasks/${args.taskIdHex}/compute-bonds?${params.toString()}`;
}

export function useTask(taskIdHex: string | null) {
  const program = useTaskMarketProgram();
  return useQuery({
    queryKey: ['task', taskIdHex],
    enabled: Boolean(program && taskIdHex && taskIdHex.length === 64),
    queryFn: () => fetchTaskById(program!, taskIdHex!),
    refetchInterval: 15_000,
  });
}

export function useTasksByClient(client: PublicKey | null) {
  const program = useTaskMarketProgram();
  return useQuery({
    queryKey: ['tasks', 'by-client', client?.toBase58()],
    enabled: Boolean(program && client),
    queryFn: () => fetchTasksByClient(program!, client!),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useRecentTasks(limit = 20, statuses?: string[]) {
  const program = useTaskMarketProgram();
  const statusKey = statuses?.join(',') ?? 'all';
  return useQuery({
    queryKey: ['task-market', 'recent', limit, statusKey],
    enabled: Boolean(program),
    queryFn: () => fetchRecentTasks(program!, { limit, statuses }),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useDiscoveryTasks({
  indexerUrl,
  statuses,
  capability,
  minReward,
  page = 1,
  limit = 20,
  enabled = true,
}: UseDiscoveryTasksArgs) {
  return useQuery<IndexedTaskSummary[]>({
    queryKey: ['discovery-tasks', indexerUrl, statuses?.join(',') ?? null, capability ?? null, minReward ?? null, page, limit],
    enabled,
    queryFn: ({ signal }) =>
      fetchIndexerJson<{ items: RawIndexedTaskSummary[] }>(
        buildTasksUrl(indexerUrl, { indexerUrl, statuses, capability, minReward, page, limit, enabled }),
        signal,
      ).then((raw) => raw.items.map(mapIndexedTask)),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useDiscoveryAgentTasks({
  indexerUrl,
  agentDidHex,
  statuses,
  page = 1,
  limit = 50,
  enabled = true,
}: UseDiscoveryAgentTasksArgs) {
  const ready = Boolean(agentDidHex && agentDidHex.length === 64);
  return useQuery<IndexedTaskSummary[]>({
    queryKey: ['discovery-agent-tasks', indexerUrl, agentDidHex, statuses?.join(',') ?? null, page, limit],
    enabled: enabled && ready,
    queryFn: ({ signal }) =>
      fetchIndexerJson<{ items: RawIndexedTaskSummary[] }>(
        buildAgentTasksUrl(indexerUrl, { indexerUrl, agentDidHex, statuses, page, limit, enabled }),
        signal,
      ).then((raw) => raw.items.map(mapIndexedTask)),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useTaskComputeBonds({
  indexerUrl,
  taskIdHex,
  status,
  provider,
  limit = 50,
  enabled = true,
}: UseTaskComputeBondsArgs) {
  const ready = Boolean(taskIdHex && taskIdHex.length === 64);
  return useQuery<DiscoveryComputeBondSummary[]>({
    queryKey: ['task-compute-bonds', indexerUrl, taskIdHex, status ?? null, provider ?? null, limit],
    enabled: enabled && ready,
    queryFn: ({ signal }) =>
      fetchIndexerJson<RawTaskBondsResponse>(
        buildTaskComputeBondsUrl(indexerUrl, { indexerUrl, taskIdHex, status, provider, limit, enabled }),
        signal,
      ).then((raw) => raw.items.map(mapComputeBond)),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useTaskMarketConfig() {
  const program = useTaskMarketProgram();
  return useQuery({
    queryKey: ['task-market', 'config'],
    enabled: Boolean(program),
    queryFn: () => fetchMarketGlobal(program!),
    staleTime: 60_000,
  });
}

export function useRaiseDispute() {
  const program = useTaskMarketProgram();
  const { connection } = useConnection();
  const { sendTransaction, publicKey } = useWallet();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (task: PublicKey) => {
      if (!program) throw new Error('Wallet not connected');
      if (!publicKey) throw new Error('Missing wallet publicKey');
      const ix = await buildRaiseDisputeIx(program, { task, client: publicKey });
      const tx = new Transaction().add(ix);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      return sig;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task'] });
    },
  });
}
