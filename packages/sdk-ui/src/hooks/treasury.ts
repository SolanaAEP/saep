'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PublicKey, Transaction } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  DEFAULT_YIELD_STRATEGIES,
  computeDeployableUsdMicro,
  fetchAllowedMints,
  fetchStrategyPosition,
  fetchStrategyPositionsByAgent,
  fetchStreamsByAgent,
  fetchVaultBalances,
  buildDepositToYieldStrategyIx,
  buildEmergencyUnwindYieldStrategyIx,
  buildRequestTreasuryYieldUnwindIx,
  buildSetTreasuryYieldConfigIx,
  buildWithdrawFromYieldStrategyIx,
  buildSetLimitsIx,
  type DepositToYieldStrategyInput,
  type EmergencyUnwindYieldStrategyInput,
  type RequestTreasuryYieldUnwindInput,
  type SetLimitsInput,
  type SetTreasuryYieldConfigInput,
  type StrategyPositionSummary,
  type TreasuryYieldPolicy,
  type TreasuryYieldSnapshot,
  type WithdrawFromYieldStrategyInput,
  type YieldStrategyDescriptor,
} from '@saep/sdk';
import { useTreasuryProgram } from './program.js';

export function useAllowedMints() {
  const program = useTreasuryProgram();
  return useQuery({
    queryKey: ['treasury', 'allowed-mints'],
    enabled: Boolean(program),
    queryFn: () => fetchAllowedMints(program!),
    staleTime: 60_000,
  });
}

export function useAgentStreams(agentDid: Uint8Array | null) {
  const program = useTreasuryProgram();
  const key = agentDid ? Buffer.from(agentDid).toString('hex') : null;
  return useQuery({
    queryKey: ['treasury', 'streams', key],
    enabled: Boolean(program && agentDid),
    queryFn: () => fetchStreamsByAgent(program!, agentDid!),
    refetchInterval: 10_000,
  });
}

export function useVaultBalances(agentDid: Uint8Array | null, mints: PublicKey[]) {
  const program = useTreasuryProgram();
  const didKey = agentDid ? Buffer.from(agentDid).toString('hex') : null;
  const mintKeys = mints.map((m) => m.toBase58()).sort().join(',');
  return useQuery({
    queryKey: ['treasury', 'vaults', didKey, mintKeys],
    enabled: Boolean(program && agentDid && mints.length > 0),
    queryFn: () => fetchVaultBalances(program!, agentDid!, mints),
    staleTime: 15_000,
  });
}

export function useStrategyPosition(
  agentDid: Uint8Array | null,
  strategyId: Uint8Array | null,
  mint: PublicKey | null,
) {
  const program = useTreasuryProgram();
  const didKey = agentDid ? Buffer.from(agentDid).toString('hex') : null;
  const strategyKey = strategyId ? Buffer.from(strategyId).toString('hex') : null;
  return useQuery<StrategyPositionSummary | null>({
    queryKey: ['treasury', 'yield-position', didKey, strategyKey, mint?.toBase58() ?? null],
    enabled: Boolean(program && agentDid && strategyId && mint),
    queryFn: () => fetchStrategyPosition(program!, agentDid!, strategyId!, mint!),
    staleTime: 15_000,
  });
}

export function useStrategyPositionsByAgent(agentDid: Uint8Array | null) {
  const program = useTreasuryProgram();
  const didKey = agentDid ? Buffer.from(agentDid).toString('hex') : null;
  return useQuery<StrategyPositionSummary[]>({
    queryKey: ['treasury', 'yield-positions', didKey],
    enabled: Boolean(program && agentDid),
    queryFn: () => fetchStrategyPositionsByAgent(program!, agentDid!),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useSetLimits() {
  const program = useTreasuryProgram();
  const { connection } = useConnection();
  const { sendTransaction, publicKey } = useWallet();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: Omit<SetLimitsInput, 'operator'>) => {
      if (!program) throw new Error('Wallet not connected');
      if (!publicKey) throw new Error('Missing wallet publicKey');
      const ix = await buildSetLimitsIx(program, { ...input, operator: publicKey });
      const tx = new Transaction().add(ix);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      return sig;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['treasury'] });
    },
  });
}

export function useSetTreasuryYieldConfig() {
  const program = useTreasuryProgram();
  const { connection } = useConnection();
  const { sendTransaction, publicKey } = useWallet();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: Omit<SetTreasuryYieldConfigInput, 'operator'>) => {
      if (!program) throw new Error('Wallet not connected');
      if (!publicKey) throw new Error('Missing wallet publicKey');
      const ix = await buildSetTreasuryYieldConfigIx(program, { ...input, operator: publicKey });
      const tx = new Transaction().add(ix);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      return sig;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['treasury'] });
      qc.invalidateQueries({ queryKey: ['indexed-treasury-yield'] });
      qc.invalidateQueries({ queryKey: ['indexed-treasury-yield-positions'] });
    },
  });
}

export function useRequestTreasuryYieldUnwind() {
  const program = useTreasuryProgram();
  const { connection } = useConnection();
  const { sendTransaction, publicKey } = useWallet();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: Omit<RequestTreasuryYieldUnwindInput, 'operator'>) => {
      if (!program) throw new Error('Wallet not connected');
      if (!publicKey) throw new Error('Missing wallet publicKey');
      const ix = await buildRequestTreasuryYieldUnwindIx(program, { ...input, operator: publicKey });
      const tx = new Transaction().add(ix);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      return sig;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['treasury'] });
      qc.invalidateQueries({ queryKey: ['indexed-treasury-yield'] });
      qc.invalidateQueries({ queryKey: ['indexed-treasury-yield-positions'] });
    },
  });
}

export function useDepositToYieldStrategy() {
  const program = useTreasuryProgram();
  const { connection } = useConnection();
  const { sendTransaction, publicKey } = useWallet();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: Omit<DepositToYieldStrategyInput, 'operator'>) => {
      if (!program) throw new Error('Wallet not connected');
      if (!publicKey) throw new Error('Missing wallet publicKey');
      const ix = await buildDepositToYieldStrategyIx(program, { ...input, operator: publicKey });
      const tx = new Transaction().add(ix);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      return sig;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['treasury'] });
      qc.invalidateQueries({ queryKey: ['indexed-treasury-yield'] });
      qc.invalidateQueries({ queryKey: ['indexed-treasury-yield-positions'] });
    },
  });
}

export function useWithdrawFromYieldStrategy() {
  const program = useTreasuryProgram();
  const { connection } = useConnection();
  const { sendTransaction, publicKey } = useWallet();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: Omit<WithdrawFromYieldStrategyInput, 'operator'>) => {
      if (!program) throw new Error('Wallet not connected');
      if (!publicKey) throw new Error('Missing wallet publicKey');
      const ix = await buildWithdrawFromYieldStrategyIx(program, { ...input, operator: publicKey });
      const tx = new Transaction().add(ix);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      return sig;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['treasury'] });
      qc.invalidateQueries({ queryKey: ['indexed-treasury-yield'] });
      qc.invalidateQueries({ queryKey: ['indexed-treasury-yield-positions'] });
    },
  });
}

export function useEmergencyUnwindYieldStrategy() {
  const program = useTreasuryProgram();
  const { connection } = useConnection();
  const { sendTransaction, publicKey } = useWallet();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: Omit<EmergencyUnwindYieldStrategyInput, 'authority'>) => {
      if (!program) throw new Error('Wallet not connected');
      if (!publicKey) throw new Error('Missing wallet publicKey');
      const ix = await buildEmergencyUnwindYieldStrategyIx(program, { ...input, authority: publicKey });
      const tx = new Transaction().add(ix);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      return sig;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['treasury'] });
      qc.invalidateQueries({ queryKey: ['indexed-treasury-yield'] });
      qc.invalidateQueries({ queryKey: ['indexed-treasury-yield-positions'] });
    },
  });
}

type ResearchMintMeta = {
  symbol: string;
  decimals: number;
  stableUsd: boolean;
};

const RESEARCH_MINT_META: Record<string, ResearchMintMeta> = {
  So11111111111111111111111111111111111111112: { symbol: 'SOL', decimals: 9, stableUsd: false },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', decimals: 6, stableUsd: true },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', decimals: 6, stableUsd: true },
  '6UpQcMAb5xMzxc7ZfPaVMgx3KqsvKZdT5U718BzD5We2': { symbol: 'wXRP', decimals: 6, stableUsd: false },
};

const DEFAULT_YIELD_POLICY: TreasuryYieldPolicy = {
  allowedStrategyIds: [DEFAULT_YIELD_STRATEGIES[0]!.id],
  maxAllocationBps: 2_500,
  paused: false,
  emergencyUnwindEnabled: true,
};

export interface YieldResearchPosition {
  mint: PublicKey;
  symbol: string;
  decimals: number;
  stableUsd: boolean;
  rawAmount: bigint;
  usdMicro: bigint;
  exists: boolean;
}

export interface YieldResearchSnapshotData {
  snapshot: TreasuryYieldSnapshot;
  policy: TreasuryYieldPolicy;
  strategies: YieldStrategyDescriptor[];
  deployableUsdMicro: bigint;
  positions: YieldResearchPosition[];
  blockedReasons: string[];
}

export interface IndexedYieldStrategySummary {
  strategyIdHex: string;
  venue: string;
  strategyProgram: string;
  underlyingMint: string;
  receiptMint: string;
  maxAllocationBps: number;
  riskTier: string;
  status: string;
  name: string;
  metadataUri: string;
  registeredUnix: number;
  statusUpdatedUnix: number | null;
}

export interface IndexedTreasuryYieldSnapshot {
  didHex: string;
  strategyIdHex: string;
  allocationBps: number;
  status: string;
  unwindRequested: boolean;
  idleAmount: string;
  deployedAmount: string;
  realizedYieldAmount: string;
  accountingSlot: number | null;
  configuredUnix: number;
  unwindRequestedUnix: number | null;
  accountingUpdatedUnix: number | null;
}

export interface IndexedTreasuryYieldPosition {
  didHex: string;
  strategyIdHex: string;
  vaultMint: string;
  receiptMint: string;
  principalAmount: string;
  receiptAmount: string;
  realizedYieldAmount: string;
  deployedAmount: string;
  idleAmount: string;
  accountingSlot: number | null;
  status: string;
  unwindRequested: boolean;
  lastEventName: string;
  updatedUnix: number;
}

interface RawIndexedYieldStrategySummary {
  strategy_id_hex: string;
  venue: string;
  strategy_program: string;
  underlying_mint: string;
  receipt_mint: string;
  max_allocation_bps: number;
  risk_tier: string;
  status: string;
  name: string;
  metadata_uri: string;
  registered_unix: number;
  status_updated_unix: number | null;
}

interface RawIndexedTreasuryYieldSnapshot {
  did_hex: string;
  strategy_id_hex: string;
  allocation_bps: number;
  status: string;
  unwind_requested: boolean;
  idle_amount: string;
  deployed_amount: string;
  realized_yield_amount: string;
  accounting_slot: number | null;
  configured_unix: number;
  unwind_requested_unix: number | null;
  accounting_updated_unix: number | null;
}

interface RawIndexedTreasuryYieldPosition {
  did_hex: string;
  strategy_id_hex: string;
  vault_mint: string;
  receipt_mint: string;
  principal_amount: string;
  receipt_amount: string;
  realized_yield_amount: string;
  deployed_amount: string;
  idle_amount: string;
  accounting_slot: number | null;
  status: string;
  unwind_requested: boolean;
  last_event_name: string;
  updated_unix: number;
}

interface RawIndexedYieldStrategiesPage {
  items: RawIndexedYieldStrategySummary[];
}

interface RawIndexedTreasuryYieldPositionsPage {
  items: RawIndexedTreasuryYieldPosition[];
}

async function fetchDiscoveryJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`indexer ${res.status}: ${body || res.statusText}`);
  }
  return (await res.json()) as T;
}

function mapYieldStrategy(raw: RawIndexedYieldStrategySummary): IndexedYieldStrategySummary {
  return {
    strategyIdHex: raw.strategy_id_hex,
    venue: raw.venue,
    strategyProgram: raw.strategy_program,
    underlyingMint: raw.underlying_mint,
    receiptMint: raw.receipt_mint,
    maxAllocationBps: raw.max_allocation_bps,
    riskTier: raw.risk_tier,
    status: raw.status,
    name: raw.name,
    metadataUri: raw.metadata_uri,
    registeredUnix: raw.registered_unix,
    statusUpdatedUnix: raw.status_updated_unix,
  };
}

function mapTreasuryYieldSnapshot(
  raw: RawIndexedTreasuryYieldSnapshot,
): IndexedTreasuryYieldSnapshot {
  return {
    didHex: raw.did_hex,
    strategyIdHex: raw.strategy_id_hex,
    allocationBps: raw.allocation_bps,
    status: raw.status,
    unwindRequested: raw.unwind_requested,
    idleAmount: raw.idle_amount,
    deployedAmount: raw.deployed_amount,
    realizedYieldAmount: raw.realized_yield_amount,
    accountingSlot: raw.accounting_slot,
    configuredUnix: raw.configured_unix,
    unwindRequestedUnix: raw.unwind_requested_unix,
    accountingUpdatedUnix: raw.accounting_updated_unix,
  };
}

function mapTreasuryYieldPosition(
  raw: RawIndexedTreasuryYieldPosition,
): IndexedTreasuryYieldPosition {
  return {
    didHex: raw.did_hex,
    strategyIdHex: raw.strategy_id_hex,
    vaultMint: raw.vault_mint,
    receiptMint: raw.receipt_mint,
    principalAmount: raw.principal_amount,
    receiptAmount: raw.receipt_amount,
    realizedYieldAmount: raw.realized_yield_amount,
    deployedAmount: raw.deployed_amount,
    idleAmount: raw.idle_amount,
    accountingSlot: raw.accounting_slot,
    status: raw.status,
    unwindRequested: raw.unwind_requested,
    lastEventName: raw.last_event_name,
    updatedUnix: raw.updated_unix,
  };
}

function mintMeta(mint: PublicKey): ResearchMintMeta {
  return RESEARCH_MINT_META[mint.toBase58()] ?? { symbol: mint.toBase58().slice(0, 4), decimals: 9, stableUsd: false };
}

export function rawToUsdMicro(raw: bigint, decimals: number, stableUsd: boolean): bigint {
  if (!stableUsd) return 0n;
  if (decimals === 6) return raw;
  if (decimals > 6) return raw / 10n ** BigInt(decimals - 6);
  return raw * 10n ** BigInt(6 - decimals);
}

export interface UseIndexedYieldStrategiesArgs {
  indexerUrl: string;
  venue?: 'kamino' | 'marginfi' | 'drift';
  status?: 'active' | 'paused' | 'revoked';
  limit?: number;
  enabled?: boolean;
}

export function useIndexedYieldStrategies({
  indexerUrl,
  venue,
  status,
  limit = 50,
  enabled = true,
}: UseIndexedYieldStrategiesArgs) {
  return useQuery<IndexedYieldStrategySummary[]>({
    queryKey: ['indexed-yield-strategies', indexerUrl, venue ?? null, status ?? null, limit],
    enabled,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (venue) params.set('venue', venue);
      if (status) params.set('status', status);
      params.set('limit', String(limit));
      const url = `${indexerUrl.replace(/\/$/, '')}/v1/discovery/treasury/yield-strategies?${params.toString()}`;
      return fetchDiscoveryJson<RawIndexedYieldStrategiesPage>(url, signal).then((raw) =>
        raw.items.map(mapYieldStrategy),
      );
    },
    staleTime: 30_000,
  });
}

export interface UseIndexedTreasuryYieldArgs {
  indexerUrl: string;
  agentDidHex: string | null;
  enabled?: boolean;
}

export function useIndexedTreasuryYield({
  indexerUrl,
  agentDidHex,
  enabled = true,
}: UseIndexedTreasuryYieldArgs) {
  return useQuery<IndexedTreasuryYieldSnapshot | null>({
    queryKey: ['indexed-treasury-yield', indexerUrl, agentDidHex],
    enabled: enabled && Boolean(agentDidHex && agentDidHex.length === 64),
    queryFn: async ({ signal }) => {
      const url = `${indexerUrl.replace(/\/$/, '')}/v1/discovery/treasury/${agentDidHex}/yield`;
      try {
        return await fetchDiscoveryJson<RawIndexedTreasuryYieldSnapshot>(url, signal).then(
          mapTreasuryYieldSnapshot,
        );
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('indexer 404:')) return null;
        throw err;
      }
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useIndexedTreasuryYieldPositions({
  indexerUrl,
  agentDidHex,
  enabled = true,
}: UseIndexedTreasuryYieldArgs) {
  return useQuery<IndexedTreasuryYieldPosition[]>({
    queryKey: ['indexed-treasury-yield-positions', indexerUrl, agentDidHex],
    enabled: enabled && Boolean(agentDidHex && agentDidHex.length === 64),
    queryFn: ({ signal }) => {
      const url = `${indexerUrl.replace(/\/$/, '')}/v1/discovery/treasury/${agentDidHex}/yield/positions`;
      return fetchDiscoveryJson<RawIndexedTreasuryYieldPositionsPage>(url, signal).then((raw) =>
        raw.items.map(mapTreasuryYieldPosition),
      );
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useTreasuryYieldResearch(
  agentDid: Uint8Array | null,
  policy: TreasuryYieldPolicy = DEFAULT_YIELD_POLICY,
) {
  const allowedMints = useAllowedMints();
  const balances = useVaultBalances(agentDid, allowedMints.data ?? []);

  return useMemo(() => {
    const positions: YieldResearchPosition[] = (balances.data ?? []).map((balance) => {
      const meta = mintMeta(balance.mint);
      return {
        mint: balance.mint,
        symbol: meta.symbol,
        decimals: meta.decimals,
        stableUsd: meta.stableUsd,
        rawAmount: balance.amount,
        usdMicro: rawToUsdMicro(balance.amount, meta.decimals, meta.stableUsd),
        exists: balance.exists,
      };
    });

    const idleUsdMicro = positions
      .filter((position) => position.exists)
      .reduce((sum, position) => sum + position.usdMicro, 0n);

    const activeStrategies = DEFAULT_YIELD_STRATEGIES.filter((strategy) =>
      policy.allowedStrategyIds.includes(strategy.id),
    );

    const snapshot: TreasuryYieldSnapshot = {
      status: policy.paused
        ? 'paused'
        : idleUsdMicro > 0n && activeStrategies.length > 0
          ? 'active'
          : 'inactive',
      idleUsdMicro,
      deployedUsdMicro: 0n,
      realizedYieldUsdMicro: 0n,
      strategyId: activeStrategies[0]?.id ?? null,
    };

    const blockedReasons: string[] = [];
    if (policy.paused) blockedReasons.push('policy paused');
    if (activeStrategies.length === 0) blockedReasons.push('no active strategy selected');
    if (idleUsdMicro === 0n) blockedReasons.push('no supported stable balances available');

    const data: YieldResearchSnapshotData = {
      snapshot,
      policy,
      strategies: activeStrategies,
      deployableUsdMicro: computeDeployableUsdMicro(snapshot, policy),
      positions,
      blockedReasons,
    };

    return {
      data,
      isLoading: allowedMints.isLoading || balances.isLoading,
      error: allowedMints.error ?? balances.error ?? null,
      allowedMints,
      balances,
    };
  }, [allowedMints, balances, policy, agentDid]);
}
