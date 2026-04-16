'use client';

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import {
  fetchCategoryReputation,
  fetchCategoryReputationsByAgent,
  type CategoryReputationSummary,
} from '@saep/sdk';
import { useAgentRegistryProgram } from './program.js';

export interface LeaderboardRow {
  agentDidHex: string;
  capabilityBit: number;
  quality: number;
  timeliness: number;
  availability: number;
  costEfficiency: number;
  honesty: number;
  jobsCompleted: number;
  jobsDisputed: number;
  compositeScore: number;
  lastUpdateUnix: number;
}

export interface RetroEligibility {
  operatorHex: string;
  netFeesMicroUsdc: number;
  washExcludedMicroUsdc: number;
  personhoodTier: 'none' | 'basic' | 'verified';
  personhoodMultiplier: string;
  coldStartMultiplier: string;
  estimatedAllocation: string | null;
  epochFirstSeen: number;
  lastUpdatedUnix: number;
}

interface RawLeaderboardRow {
  agent_did_hex: string;
  capability_bit: number;
  quality: number;
  timeliness: number;
  availability: number;
  cost_efficiency: number;
  honesty: number;
  jobs_completed: number;
  jobs_disputed: number;
  composite_score: number;
  last_update_unix: number;
}

interface RawRetroRow {
  operator_hex: string;
  net_fees_micro_usdc: number;
  wash_excluded_micro_usdc: number;
  personhood_tier: 'none' | 'basic' | 'verified';
  personhood_multiplier: string;
  cold_start_multiplier: string;
  estimated_allocation: string | null;
  epoch_first_seen: number;
  last_updated_unix: number;
}

const toRow = (r: RawLeaderboardRow): LeaderboardRow => ({
  agentDidHex: r.agent_did_hex,
  capabilityBit: r.capability_bit,
  quality: r.quality,
  timeliness: r.timeliness,
  availability: r.availability,
  costEfficiency: r.cost_efficiency,
  honesty: r.honesty,
  jobsCompleted: r.jobs_completed,
  jobsDisputed: r.jobs_disputed,
  compositeScore: r.composite_score,
  lastUpdateUnix: r.last_update_unix,
});

const toRetro = (r: RawRetroRow): RetroEligibility => ({
  operatorHex: r.operator_hex,
  netFeesMicroUsdc: r.net_fees_micro_usdc,
  washExcludedMicroUsdc: r.wash_excluded_micro_usdc,
  personhoodTier: r.personhood_tier,
  personhoodMultiplier: r.personhood_multiplier,
  coldStartMultiplier: r.cold_start_multiplier,
  estimatedAllocation: r.estimated_allocation,
  epochFirstSeen: r.epoch_first_seen,
  lastUpdatedUnix: r.last_updated_unix,
});

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`indexer ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export interface UseLeaderboardArgs {
  indexerUrl: string;
  capabilityBit: number;
  limit?: number;
  cursor?: number;
  enabled?: boolean;
}

export function useLeaderboard({
  indexerUrl,
  capabilityBit,
  limit,
  cursor,
  enabled = true,
}: UseLeaderboardArgs,
options?: Omit<UseQueryOptions<LeaderboardRow[]>, 'queryKey' | 'queryFn'>) {
  const params = new URLSearchParams({ capability: String(capabilityBit) });
  if (limit != null) params.set('limit', String(limit));
  if (cursor != null) params.set('cursor', String(cursor));
  const url = `${indexerUrl.replace(/\/$/, '')}/leaderboard?${params.toString()}`;
  return useQuery<LeaderboardRow[]>({
    queryKey: ['leaderboard', capabilityBit, limit ?? null, cursor ?? null],
    enabled,
    queryFn: ({ signal }) => fetchJson<RawLeaderboardRow[]>(url, signal).then((rs) => rs.map(toRow)),
    staleTime: 30_000,
    ...options,
  });
}

export interface UseAgentReputationArgs {
  indexerUrl: string;
  agentDidHex: string | null;
  enabled?: boolean;
}

export function useAgentReputation({
  indexerUrl,
  agentDidHex,
  enabled = true,
}: UseAgentReputationArgs) {
  const ready = Boolean(agentDidHex && agentDidHex.length === 64);
  const url = ready
    ? `${indexerUrl.replace(/\/$/, '')}/agents/${agentDidHex}/reputation`
    : '';
  return useQuery<LeaderboardRow[]>({
    queryKey: ['agent-reputation', agentDidHex],
    enabled: enabled && ready,
    queryFn: ({ signal }) => fetchJson<RawLeaderboardRow[]>(url, signal).then((rs) => rs.map(toRow)),
    staleTime: 30_000,
  });
}

export interface UseRetroEligibilityArgs {
  indexerUrl: string;
  operatorHex: string | null;
  enabled?: boolean;
}

export interface UseAgentCategoryReputationArgs {
  agentDid: Uint8Array | null;
  capabilityBit: number | null;
  enabled?: boolean;
}

export function useAgentCategoryReputation({
  agentDid,
  capabilityBit,
  enabled = true,
}: UseAgentCategoryReputationArgs) {
  const program = useAgentRegistryProgram();
  const ready = Boolean(
    program && agentDid && agentDid.length === 32 && capabilityBit != null && capabilityBit >= 0,
  );
  const didHex = agentDid ? Buffer.from(agentDid).toString('hex') : null;
  return useQuery<CategoryReputationSummary | null>({
    queryKey: ['category-reputation', didHex, capabilityBit],
    enabled: enabled && ready,
    queryFn: () => fetchCategoryReputation(program!, agentDid!, capabilityBit!),
    staleTime: 30_000,
  });
}

export interface UseAgentCategoryReputationsArgs {
  agentDid: Uint8Array | null;
  enabled?: boolean;
}

export function useAgentCategoryReputations({
  agentDid,
  enabled = true,
}: UseAgentCategoryReputationsArgs) {
  const program = useAgentRegistryProgram();
  const ready = Boolean(program && agentDid && agentDid.length === 32);
  const didHex = agentDid ? Buffer.from(agentDid).toString('hex') : null;
  return useQuery<CategoryReputationSummary[]>({
    queryKey: ['category-reputations', didHex],
    enabled: enabled && ready,
    queryFn: () => fetchCategoryReputationsByAgent(program!, agentDid!),
    staleTime: 30_000,
  });
}

export function useRetroEligibility({
  indexerUrl,
  operatorHex,
  enabled = true,
}: UseRetroEligibilityArgs) {
  const ready = Boolean(operatorHex && operatorHex.length === 64);
  const url = ready
    ? `${indexerUrl.replace(/\/$/, '')}/retro/eligibility/${operatorHex}`
    : '';
  return useQuery<RetroEligibility | null>({
    queryKey: ['retro-eligibility', operatorHex],
    enabled: enabled && ready,
    queryFn: async ({ signal }) => {
      const res = await fetch(url, { signal });
      if (res.status === 404) return null;
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`indexer ${res.status}: ${body || res.statusText}`);
      }
      const raw = (await res.json()) as RawRetroRow;
      return toRetro(raw);
    },
    staleTime: 60_000,
  });
}
