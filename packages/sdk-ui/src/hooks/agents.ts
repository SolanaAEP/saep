'use client';

import { useQuery } from '@tanstack/react-query';
import { PublicKey } from '@solana/web3.js';
import {
  fetchAgentsByOperator,
  fetchAgentByDid,
  fetchTasksByAgent,
  fetchTreasury,
  fetchAllAgentsDetailed,
} from '@saep/sdk';
import { useAgentRegistryProgram, useTaskMarketProgram, useTreasuryProgram } from './program.js';

export interface DiscoveryAgentMatchSummary {
  requiredCapabilityBits: number[];
  matchedCapabilityBits: number[];
  missingCapabilityBits: number[];
  coverageBps: number;
  fitScore: number;
  capabilityReputationComposite: number | null;
  availability: number | null;
  costEfficiency: number | null;
  jobsCompleted: number;
  jobsDisputed: number;
}

export interface DiscoveryAgentSummary {
  didHex: string;
  operator: string | null;
  capabilityMask: string | null;
  stakeLamports: string | null;
  reputationComposite: number;
  status: string;
  lastActiveUnix: number;
  matchSummary: DiscoveryAgentMatchSummary | null;
}

export interface UseDiscoveryAgentsArgs {
  indexerUrl: string;
  capabilityMaskHex?: string | null;
  minReputation?: number;
  status?: 'active' | 'slashed' | 'paused' | 'suspended';
  sort?: 'reputation_desc' | 'recent_desc';
  limit?: number;
  enabled?: boolean;
}

interface RawDiscoveryAgentMatchSummary {
  required_capability_bits: number[];
  matched_capability_bits: number[];
  missing_capability_bits: number[];
  coverage_bps: number;
  fit_score: number;
  capability_reputation_composite: number | null;
  availability: number | null;
  cost_efficiency: number | null;
  jobs_completed: number;
  jobs_disputed: number;
}

interface RawDiscoveryAgentSummary {
  did_hex: string;
  operator: string | null;
  capability_mask: string | null;
  stake_lamports: string | null;
  reputation_composite: number;
  status: string;
  last_active_unix: number;
  match_summary?: RawDiscoveryAgentMatchSummary | null;
}

interface RawDiscoveryAgentsPage {
  items: RawDiscoveryAgentSummary[];
  cursor: string | null;
}

async function fetchDiscoveryJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`indexer ${res.status}: ${body || res.statusText}`);
  }
  return (await res.json()) as T;
}

function buildDiscoveryAgentsUrl(baseUrl: string, args: UseDiscoveryAgentsArgs): string {
  const params = new URLSearchParams();
  if (args.capabilityMaskHex) params.set('capability_mask', args.capabilityMaskHex);
  if (args.minReputation != null) params.set('min_reputation', String(args.minReputation));
  if (args.status) params.set('status', args.status);
  if (args.sort) params.set('sort', args.sort);
  params.set('limit', String(args.limit ?? 50));
  return `${baseUrl.replace(/\/$/, '')}/v1/discovery/agents?${params.toString()}`;
}

function mapDiscoveryMatchSummary(
  raw: RawDiscoveryAgentMatchSummary | null | undefined,
): DiscoveryAgentMatchSummary | null {
  if (!raw) return null;
  return {
    requiredCapabilityBits: raw.required_capability_bits,
    matchedCapabilityBits: raw.matched_capability_bits,
    missingCapabilityBits: raw.missing_capability_bits,
    coverageBps: raw.coverage_bps,
    fitScore: raw.fit_score,
    capabilityReputationComposite: raw.capability_reputation_composite,
    availability: raw.availability,
    costEfficiency: raw.cost_efficiency,
    jobsCompleted: raw.jobs_completed,
    jobsDisputed: raw.jobs_disputed,
  };
}

function mapDiscoveryAgent(raw: RawDiscoveryAgentSummary): DiscoveryAgentSummary {
  return {
    didHex: raw.did_hex,
    operator: raw.operator,
    capabilityMask: raw.capability_mask,
    stakeLamports: raw.stake_lamports,
    reputationComposite: raw.reputation_composite,
    status: raw.status,
    lastActiveUnix: raw.last_active_unix,
    matchSummary: mapDiscoveryMatchSummary(raw.match_summary),
  };
}

export function useAgentsByOperator(operator: PublicKey | null) {
  const program = useAgentRegistryProgram();
  return useQuery({
    queryKey: ['agents', operator?.toBase58()],
    enabled: Boolean(program && operator),
    queryFn: () => fetchAgentsByOperator(program!, operator!),
  });
}

export function useAgent(didHex: string | null) {
  const program = useAgentRegistryProgram();
  return useQuery({
    queryKey: ['agent', didHex],
    enabled: Boolean(program && didHex && didHex.length === 64),
    queryFn: () => fetchAgentByDid(program!, didHex!),
  });
}

export function useAgentTasks(didHex: string | null) {
  const program = useTaskMarketProgram();
  return useQuery({
    queryKey: ['agent-tasks', didHex],
    enabled: Boolean(program && didHex && didHex.length === 64),
    queryFn: () => fetchTasksByAgent(program!, didHex!),
  });
}

export function useAllAgents() {
  const program = useAgentRegistryProgram();
  return useQuery({
    queryKey: ['agents', 'all'],
    enabled: Boolean(program),
    queryFn: () => fetchAllAgentsDetailed(program!),
    staleTime: 30_000,
  });
}

export function useDiscoveryAgents({
  indexerUrl,
  capabilityMaskHex,
  minReputation,
  status = 'active',
  sort = 'reputation_desc',
  limit = 50,
  enabled = true,
}: UseDiscoveryAgentsArgs) {
  return useQuery<DiscoveryAgentSummary[]>({
    queryKey: ['discovery-agents', indexerUrl, capabilityMaskHex ?? null, minReputation ?? null, status, sort, limit],
    enabled,
    queryFn: ({ signal }) =>
      fetchDiscoveryJson<RawDiscoveryAgentsPage>(
        buildDiscoveryAgentsUrl(indexerUrl, {
          indexerUrl,
          capabilityMaskHex,
          minReputation,
          status,
          sort,
          limit,
          enabled,
        }),
        signal,
      ).then((raw) => raw.items.map(mapDiscoveryAgent)),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useTreasury(agentDid: Uint8Array | null) {
  const program = useTreasuryProgram();
  const key = agentDid ? Buffer.from(agentDid).toString('hex') : null;
  return useQuery({
    queryKey: ['treasury', key],
    enabled: Boolean(program && agentDid),
    queryFn: () => fetchTreasury(program!, agentDid!),
  });
}
