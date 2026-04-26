'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PublicKey, Transaction, type Connection } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  buildReleaseIx,
  buildSubmitResultIx,
  buildVerifyTaskIx,
  fetchMarketGlobal,
  fetchProofVerifierAllowedCallers,
  fetchVerifierConfig,
  fetchVerifierKey,
  fetchVerifierMode,
  fetchRecentTasks,
  fetchTaskById,
  fetchTasksByClient,
  buildRaiseDisputeIx,
  verifierKeyPda,
  type TaskDetail,
} from '@saep/sdk';
import { useCluster } from './cluster.js';
import { useProofVerifierProgram, useTaskMarketProgram } from './program.js';
import { useSendTransaction } from './mutation.js';
import {
  TASK_COMPLETION_CIRCUIT_ID,
  computeTaskCompletionVkId,
  evaluateSettlementReadiness,
  type Groth16ProofLike,
  type SettlementReadiness,
  type TaskCompletionProofGenRequest,
} from '../settlement.js';

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

export interface DiscoveryTaskMatchSummary {
  requiredCapabilityBits: number[];
  matchedCapabilityBits: number[];
  missingCapabilityBits: number[];
  coverageBps: number;
  fitScore: number;
  baseFitScoreBps: number;
  capabilityReputationComposite: number | null;
  availability: number | null;
  costEfficiency: number | null;
  honesty: number | null;
  jobsCompleted: number;
  jobsDisputed: number;
  confidenceBps: number;
  disputeRateBps: number;
  lowHistory: boolean;
  lowConfidence: boolean;
  availabilityWarning: boolean;
  disputeWarning: boolean;
  trustState: 'strong' | 'watch' | 'caution';
  lowHistoryPenaltyBps: number;
  disputePenaltyBps: number;
  availabilityPenaltyBps: number;
}

export interface DiscoveryTaskMatchCandidate {
  didHex: string;
  operator: string | null;
  capabilityMask: string | null;
  stakeLamports: string | null;
  reputationComposite: number;
  status: string;
  lastActiveUnix: number;
  matchSummary: DiscoveryTaskMatchSummary;
}

export interface IndexedTaskMatches {
  taskIdHex: string;
  taskStatus: string | null;
  capabilityBit: number;
  items: DiscoveryTaskMatchCandidate[];
}

export interface ProofGenProveResponse {
  status: string;
  job_id?: string;
  cached?: boolean;
  proof?: Groth16ProofLike;
  public_signals?: string[];
  error?: string;
}

export type ProofGenJobResponse = ProofGenProveResponse;

export interface UseSettlementReadinessArgs {
  proofGenUrl?: string;
  enabled?: boolean;
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

interface RawDiscoveryTaskMatchSummary {
  required_capability_bits: number[];
  matched_capability_bits: number[];
  missing_capability_bits: number[];
  coverage_bps: number;
  fit_score: number;
  base_fit_score_bps?: number;
  capability_reputation_composite: number | null;
  availability: number | null;
  cost_efficiency: number | null;
  honesty?: number | null;
  jobs_completed: number;
  jobs_disputed: number;
  confidence_bps?: number;
  dispute_rate_bps?: number;
  low_history?: boolean;
  low_confidence?: boolean;
  availability_warning?: boolean;
  dispute_warning?: boolean;
  trust_state?: 'strong' | 'watch' | 'caution';
  low_history_penalty_bps?: number;
  dispute_penalty_bps?: number;
  availability_penalty_bps?: number;
}

interface RawDiscoveryTaskMatchCandidate {
  did_hex: string;
  operator: string | null;
  capability_mask: string | null;
  stake_lamports: string | null;
  reputation_composite: number;
  status: string;
  last_active_unix: number;
  match_summary: RawDiscoveryTaskMatchSummary;
}

interface RawIndexedTaskMatches {
  task_id_hex: string;
  task_status: string | null;
  capability_bit: number;
  items: RawDiscoveryTaskMatchCandidate[];
}

async function fetchIndexerJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`indexer ${res.status}: ${body || res.statusText}`);
  }
  return (await res.json()) as T;
}

async function fetchServiceJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`service ${res.status}: ${body || res.statusText}`);
  }
  return (await res.json()) as T;
}

async function fetchServiceJsonOrNull<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    return await fetchServiceJson<T>(url, { signal });
  } catch {
    return null;
  }
}

async function resolveTokenProgram(connection: Connection, mint: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint, 'confirmed');
  if (!info) throw new Error(`payment mint ${mint.toBase58()} was not found`);
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  throw new Error(`payment mint ${mint.toBase58()} is not an SPL token mint`);
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

export interface UseDiscoveryTaskMatchesArgs {
  indexerUrl: string;
  taskIdHex: string | null;
  limit?: number;
  enabled?: boolean;
}

export interface UseDiscoveryTaskDetailArgs {
  indexerUrl: string;
  taskIdHex: string | null;
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

function buildTaskDetailUrl(baseUrl: string, args: UseDiscoveryTaskDetailArgs): string {
  return `${baseUrl.replace(/\/$/, '')}/tasks/${args.taskIdHex}`;
}

function buildTaskMatchesUrl(baseUrl: string, args: UseDiscoveryTaskMatchesArgs): string {
  const params = new URLSearchParams();
  params.set('limit', String(args.limit ?? 5));
  return `${baseUrl.replace(/\/$/, '')}/v1/discovery/tasks/${args.taskIdHex}/matches?${params.toString()}`;
}

function mapTaskMatchSummary(raw: RawDiscoveryTaskMatchSummary): DiscoveryTaskMatchSummary {
  return {
    requiredCapabilityBits: raw.required_capability_bits,
    matchedCapabilityBits: raw.matched_capability_bits,
    missingCapabilityBits: raw.missing_capability_bits,
    coverageBps: raw.coverage_bps,
    fitScore: raw.fit_score,
    baseFitScoreBps: raw.base_fit_score_bps ?? raw.fit_score,
    capabilityReputationComposite: raw.capability_reputation_composite,
    availability: raw.availability,
    costEfficiency: raw.cost_efficiency,
    honesty: raw.honesty ?? null,
    jobsCompleted: raw.jobs_completed,
    jobsDisputed: raw.jobs_disputed,
    confidenceBps: raw.confidence_bps ?? 0,
    disputeRateBps: raw.dispute_rate_bps ?? 0,
    lowHistory: raw.low_history ?? false,
    lowConfidence: raw.low_confidence ?? false,
    availabilityWarning: raw.availability_warning ?? false,
    disputeWarning: raw.dispute_warning ?? false,
    trustState: raw.trust_state ?? 'watch',
    lowHistoryPenaltyBps: raw.low_history_penalty_bps ?? 0,
    disputePenaltyBps: raw.dispute_penalty_bps ?? 0,
    availabilityPenaltyBps: raw.availability_penalty_bps ?? 0,
  };
}

function mapTaskMatchCandidate(raw: RawDiscoveryTaskMatchCandidate): DiscoveryTaskMatchCandidate {
  return {
    didHex: raw.did_hex,
    operator: raw.operator,
    capabilityMask: raw.capability_mask,
    stakeLamports: raw.stake_lamports,
    reputationComposite: raw.reputation_composite,
    status: raw.status,
    lastActiveUnix: raw.last_active_unix,
    matchSummary: mapTaskMatchSummary(raw.match_summary),
  };
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
    queryKey: [
      'discovery-tasks',
      indexerUrl,
      statuses?.join(',') ?? null,
      capability ?? null,
      minReward ?? null,
      page,
      limit,
    ],
    enabled,
    queryFn: ({ signal }) =>
      fetchIndexerJson<{ items: RawIndexedTaskSummary[] }>(
        buildTasksUrl(indexerUrl, {
          indexerUrl,
          statuses,
          capability,
          minReward,
          page,
          limit,
          enabled,
        }),
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
    queryKey: [
      'discovery-agent-tasks',
      indexerUrl,
      agentDidHex,
      statuses?.join(',') ?? null,
      page,
      limit,
    ],
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
    queryKey: [
      'task-compute-bonds',
      indexerUrl,
      taskIdHex,
      status ?? null,
      provider ?? null,
      limit,
    ],
    enabled: enabled && ready,
    queryFn: ({ signal }) =>
      fetchIndexerJson<RawTaskBondsResponse>(
        buildTaskComputeBondsUrl(indexerUrl, {
          indexerUrl,
          taskIdHex,
          status,
          provider,
          limit,
          enabled,
        }),
        signal,
      ).then((raw) => raw.items.map(mapComputeBond)),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useDiscoveryTaskDetail({
  indexerUrl,
  taskIdHex,
  enabled = true,
}: UseDiscoveryTaskDetailArgs) {
  const ready = Boolean(taskIdHex && taskIdHex.length === 64);
  return useQuery<IndexedTaskSummary>({
    queryKey: ['discovery-task-detail', indexerUrl, taskIdHex],
    enabled: enabled && ready,
    queryFn: ({ signal }) =>
      fetchIndexerJson<RawIndexedTaskSummary>(
        buildTaskDetailUrl(indexerUrl, { indexerUrl, taskIdHex, enabled }),
        signal,
      ).then(mapIndexedTask),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useDiscoveryTaskMatches({
  indexerUrl,
  taskIdHex,
  limit = 5,
  enabled = true,
}: UseDiscoveryTaskMatchesArgs) {
  const ready = Boolean(taskIdHex && taskIdHex.length === 64);
  return useQuery<IndexedTaskMatches>({
    queryKey: ['discovery-task-matches', indexerUrl, taskIdHex, limit],
    enabled: enabled && ready,
    queryFn: ({ signal }) =>
      fetchIndexerJson<RawIndexedTaskMatches>(
        buildTaskMatchesUrl(indexerUrl, { indexerUrl, taskIdHex, limit, enabled }),
        signal,
      ).then((raw) => ({
        taskIdHex: raw.task_id_hex,
        taskStatus: raw.task_status,
        capabilityBit: raw.capability_bit,
        items: raw.items.map(mapTaskMatchCandidate),
      })),
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

export function useSettlementReadiness({
  proofGenUrl = '/api/proofgen',
  enabled = true,
}: UseSettlementReadinessArgs = {}) {
  const taskMarketProgram = useTaskMarketProgram();
  const proofVerifierProgram = useProofVerifierProgram();
  const cluster = useCluster();

  return useQuery<SettlementReadiness>({
    queryKey: ['settlement-readiness', proofGenUrl, cluster.cluster, cluster.programIds.taskMarket.toBase58()],
    enabled: enabled && Boolean(taskMarketProgram && proofVerifierProgram),
    queryFn: async ({ signal }) => {
      if (!taskMarketProgram || !proofVerifierProgram) throw new Error('Programs unavailable');
      const vkId = await computeTaskCompletionVkId();
      const [expectedVerifierKey] = verifierKeyPda(cluster.programIds.proofVerifier, vkId);
      const proofGenBase = proofGenUrl.replace(/\/$/, '');

      const [
        market,
        verifierMode,
        verifierConfig,
        allowedCallers,
        activeVerifierKey,
        proofGenHealth,
        proofGenCircuits,
      ] = await Promise.all([
        fetchMarketGlobal(taskMarketProgram),
        fetchVerifierMode(proofVerifierProgram),
        fetchVerifierConfig(proofVerifierProgram),
        fetchProofVerifierAllowedCallers(proofVerifierProgram),
        fetchVerifierKey(proofVerifierProgram, vkId),
        fetchServiceJsonOrNull<{ ok?: boolean; artifacts?: string; verification_key?: string; circuits?: string[] }>(
          `${proofGenBase}/healthz`,
          signal,
        ),
        fetchServiceJsonOrNull<{ circuits?: Array<{
          circuit_id: string;
          slug?: string;
          lifecycle?: string;
          verifier?: string;
          verification_key_version?: number;
          public_inputs?: string[];
          artifacts?: string;
          verification_key?: string;
        }> }>(`${proofGenBase}/circuits`, signal),
      ]);

      return evaluateSettlementReadiness({
        taskMarketProgramId: cluster.programIds.taskMarket.toBase58(),
        expectedVerifierKeyAddress: expectedVerifierKey.toBase58(),
        market: market
          ? { paused: market.paused, proofVerifier: market.proofVerifier.toBase58() }
          : null,
        verifierMode,
        verifierConfig: verifierConfig
          ? { paused: verifierConfig.paused, activeVk: verifierConfig.activeVk.toBase58() }
          : null,
        activeVerifierKey: activeVerifierKey
          ? {
              address: activeVerifierKey.address.toBase58(),
              isProduction: activeVerifierKey.isProduction,
              circuitLabel: activeVerifierKey.circuitLabel,
              numPublicInputs: activeVerifierKey.numPublicInputs,
            }
          : null,
        allowedCallers: allowedCallers
          ? { programs: allowedCallers.programs.map((program) => program.toBase58()) }
          : null,
        proofGenHealth,
        proofGenCircuits,
      });
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export interface SubmitTaskResultInput {
  task: PublicKey;
  agentAccount: PublicKey;
  resultHash: Uint8Array;
  proofKey: Uint8Array;
}

export function useSubmitTaskResult() {
  const program = useTaskMarketProgram();
  const cluster = useCluster();
  const { publicKey } = useWallet();

  return useSendTransaction<SubmitTaskResultInput>({
    buildInstruction: async (input) => {
      if (!program) throw new Error('Task market program unavailable');
      if (!publicKey) throw new Error('Wallet not connected');
      return buildSubmitResultIx(program, cluster, {
        operator: publicKey,
        task: input.task,
        agentAccount: input.agentAccount,
        resultHash: input.resultHash,
        proofKey: input.proofKey,
      });
    },
    invalidateKeys: [['task'], ['discovery-tasks'], ['discovery-task-detail']],
    commitment: 'confirmed',
  });
}

export interface VerifyTaskResultInput {
  task: PublicKey;
  proofA: Uint8Array;
  proofB: Uint8Array;
  proofC: Uint8Array;
}

export function useVerifyTaskResult() {
  const program = useTaskMarketProgram();
  const cluster = useCluster();
  const { publicKey } = useWallet();

  return useSendTransaction<VerifyTaskResultInput>({
    buildInstruction: async (input) => {
      if (!program) throw new Error('Task market program unavailable');
      if (!publicKey) throw new Error('Wallet not connected');
      const vkId = await computeTaskCompletionVkId();
      const [verifierKey] = verifierKeyPda(cluster.programIds.proofVerifier, vkId);
      return buildVerifyTaskIx(program, cluster, {
        cranker: publicKey,
        task: input.task,
        verifierKey,
        vkId,
        proofA: input.proofA,
        proofB: input.proofB,
        proofC: input.proofC,
      });
    },
    invalidateKeys: [['task'], ['discovery-tasks'], ['discovery-task-detail']],
    commitment: 'confirmed',
  });
}

export interface ReleaseTaskEscrowInput {
  task: TaskDetail;
  agentAccount: PublicKey;
  agentOperator: PublicKey;
}

export function useReleaseTaskEscrow() {
  const program = useTaskMarketProgram();
  const cluster = useCluster();
  const { connection } = useConnection();
  const { publicKey } = useWallet();

  return useSendTransaction<ReleaseTaskEscrowInput>({
    buildInstruction: async (input) => {
      if (!program) throw new Error('Task market program unavailable');
      if (!publicKey) throw new Error('Wallet not connected');
      const market = await fetchMarketGlobal(program);
      if (!market) throw new Error('MarketGlobal is missing');
      const tokenProgramId = await resolveTokenProgram(connection, input.task.paymentMint);
      const agentTokenAccount = getAssociatedTokenAddressSync(
        input.task.paymentMint,
        input.agentOperator,
        true,
        tokenProgramId,
      );
      const feeCollectorTokenAccount = getAssociatedTokenAddressSync(
        input.task.paymentMint,
        market.feeCollector,
        true,
        tokenProgramId,
      );
      const solrepPoolTokenAccount = getAssociatedTokenAddressSync(
        input.task.paymentMint,
        market.solrepPool,
        true,
        tokenProgramId,
      );
      const createAtas = [
        createAssociatedTokenAccountIdempotentInstruction(
          publicKey,
          agentTokenAccount,
          input.agentOperator,
          input.task.paymentMint,
          tokenProgramId,
        ),
        createAssociatedTokenAccountIdempotentInstruction(
          publicKey,
          feeCollectorTokenAccount,
          market.feeCollector,
          input.task.paymentMint,
          tokenProgramId,
        ),
        createAssociatedTokenAccountIdempotentInstruction(
          publicKey,
          solrepPoolTokenAccount,
          market.solrepPool,
          input.task.paymentMint,
          tokenProgramId,
        ),
      ];
      const release = await buildReleaseIx(program, cluster, {
        cranker: publicKey,
        task: input.task.address,
        paymentMint: input.task.paymentMint,
        agentTokenAccount,
        feeCollectorTokenAccount,
        solrepPoolTokenAccount,
        agentAccount: input.agentAccount,
        client: input.task.client,
        tokenProgramId,
      });
      return [...createAtas, release];
    },
    invalidateKeys: [['task'], ['discovery-tasks'], ['discovery-task-detail']],
    commitment: 'confirmed',
  });
}

export function useCreateProofGenJob(proofGenUrl = '/api/proofgen') {
  return useMutation<ProofGenProveResponse, Error, TaskCompletionProofGenRequest>({
    mutationFn: (request) =>
      fetchServiceJson<ProofGenProveResponse>(`${proofGenUrl.replace(/\/$/, '')}/prove`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      }),
  });
}

export function useProofGenJob(jobId: string | null, proofGenUrl = '/api/proofgen') {
  return useQuery<ProofGenJobResponse>({
    queryKey: ['proof-gen-job', proofGenUrl, jobId],
    enabled: Boolean(jobId),
    queryFn: ({ signal }) =>
      fetchServiceJson<ProofGenJobResponse>(
        `${proofGenUrl.replace(/\/$/, '')}/jobs/${jobId}`,
        { signal },
      ),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && status !== 'completed' && status !== 'failed' ? 2_500 : false;
    },
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
      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        'confirmed',
      );
      return sig;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task'] });
    },
  });
}
