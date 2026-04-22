'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PublicKey, Transaction } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  DEFAULT_YIELD_STRATEGIES,
  computeDeployableUsdMicro,
  fetchAllowedMints,
  fetchStreamsByAgent,
  fetchVaultBalances,
  buildSetLimitsIx,
  type SetLimitsInput,
  type TreasuryYieldPolicy,
  type TreasuryYieldSnapshot,
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

function mintMeta(mint: PublicKey): ResearchMintMeta {
  return RESEARCH_MINT_META[mint.toBase58()] ?? { symbol: mint.toBase58().slice(0, 4), decimals: 9, stableUsd: false };
}

function rawToUsdMicro(raw: bigint, decimals: number, stableUsd: boolean): bigint {
  if (!stableUsd) return 0n;
  if (decimals === 6) return raw;
  if (decimals > 6) return raw / 10n ** BigInt(decimals - 6);
  return raw * 10n ** BigInt(6 - decimals);
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
