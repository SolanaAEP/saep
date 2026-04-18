'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PublicKey, Transaction } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  buildClaimBondIx,
  buildCommitBidIx,
  buildRevealBidIx,
  fetchAgentByDid,
  fetchBid,
  fetchBidBook,
  fetchBidsForTask,
} from '@saep/sdk';
import { useTaskMarketProgram, useAgentRegistryProgram } from './program.js';
import { useCluster } from './cluster.js';

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  return Uint8Array.from(clean.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}

export type BiddingPhase = 'commit' | 'reveal' | 'settled' | 'slashed' | 'unknown';

export interface BiddingState {
  taskIdHex: string;
  phase: BiddingPhase;
  commitCount: number;
  revealCount: number;
  slashedCount: number;
  bondAmount: string | null;
  commitEndUnix: number | null;
  revealEndUnix: number | null;
  winnerAgent: string | null;
  winnerBidder: string | null;
  winnerAmount: string | null;
}

export interface TaskBidIndexed {
  bidder: string;
  bondPaid: string | null;
  revealedAmount: string | null;
  slashed: boolean;
}

interface RawBiddingState {
  task_id_hex: string;
  phase: BiddingPhase;
  commit_count: number;
  reveal_count: number;
  slashed_count: number;
  bond_amount: string | null;
  commit_end_unix: number | null;
  reveal_end_unix: number | null;
  winner_agent: string | null;
  winner_bidder: string | null;
  winner_amount: string | null;
}

interface RawTaskBidIndexed {
  bidder: string;
  bond_paid: string | null;
  revealed_amount: string | null;
  slashed: boolean;
}

async function fetchIndexerJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`indexer ${res.status}: ${body || res.statusText}`);
  }
  return (await res.json()) as T;
}

export function useBiddingState(indexerUrl: string, taskIdHex: string | null) {
  const ready = Boolean(taskIdHex && taskIdHex.length === 64);
  const url = ready
    ? `${indexerUrl.replace(/\/$/, '')}/tasks/${taskIdHex}/bidding`
    : '';
  return useQuery<BiddingState>({
    queryKey: ['bidding-state', taskIdHex],
    enabled: ready,
    queryFn: async ({ signal }) => {
      const raw = await fetchIndexerJson<RawBiddingState>(url, signal);
      return {
        taskIdHex: raw.task_id_hex,
        phase: raw.phase,
        commitCount: raw.commit_count,
        revealCount: raw.reveal_count,
        slashedCount: raw.slashed_count,
        bondAmount: raw.bond_amount,
        commitEndUnix: raw.commit_end_unix,
        revealEndUnix: raw.reveal_end_unix,
        winnerAgent: raw.winner_agent,
        winnerBidder: raw.winner_bidder,
        winnerAmount: raw.winner_amount,
      };
    },
    refetchInterval: 10_000,
  });
}

export function useTaskBidsIndexed(indexerUrl: string, taskIdHex: string | null) {
  const ready = Boolean(taskIdHex && taskIdHex.length === 64);
  const url = ready
    ? `${indexerUrl.replace(/\/$/, '')}/tasks/${taskIdHex}/bids`
    : '';
  return useQuery<TaskBidIndexed[]>({
    queryKey: ['task-bids-indexed', taskIdHex],
    enabled: ready,
    queryFn: async ({ signal }) => {
      const raw = await fetchIndexerJson<RawTaskBidIndexed[]>(url, signal);
      return raw.map((r) => ({
        bidder: r.bidder,
        bondPaid: r.bond_paid,
        revealedAmount: r.revealed_amount,
        slashed: r.slashed,
      }));
    },
    refetchInterval: 10_000,
  });
}

export function useBidBook(taskIdHex: string | null) {
  const program = useTaskMarketProgram();
  return useQuery({
    queryKey: ['bid-book', taskIdHex],
    enabled: Boolean(program && taskIdHex && taskIdHex.length === 64),
    queryFn: () => fetchBidBook(program!, hexToBytes(taskIdHex!)),
    refetchInterval: 10_000,
  });
}

export function useBidsForTask(taskIdHex: string | null) {
  const program = useTaskMarketProgram();
  return useQuery({
    queryKey: ['bids-for-task', taskIdHex],
    enabled: Boolean(program && taskIdHex && taskIdHex.length === 64),
    queryFn: () => fetchBidsForTask(program!, hexToBytes(taskIdHex!)),
    refetchInterval: 10_000,
  });
}

export function useBid(taskIdHex: string | null, bidder: PublicKey | null) {
  const program = useTaskMarketProgram();
  return useQuery({
    queryKey: ['bid', taskIdHex, bidder?.toBase58() ?? null],
    enabled: Boolean(program && taskIdHex && bidder && taskIdHex.length === 64),
    queryFn: () => fetchBid(program!, hexToBytes(taskIdHex!), bidder!),
    refetchInterval: 10_000,
  });
}

export interface CommitBidArgs {
  task: PublicKey;
  taskId: Uint8Array;
  paymentMint: PublicKey;
  bidderTokenAccount: PublicKey;
  agentDidHex: string;
  commitHash: Uint8Array;
}

export function useCommitBid() {
  const program = useTaskMarketProgram();
  const ar = useAgentRegistryProgram();
  const cluster = useCluster();
  const { connection } = useConnection();
  const { sendTransaction, publicKey } = useWallet();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: CommitBidArgs) => {
      if (!program || !ar) throw new Error('Wallet not connected');
      if (!publicKey) throw new Error('Missing wallet publicKey');
      const agent = await fetchAgentByDid(ar, input.agentDidHex);
      if (!agent) throw new Error(`agent_did not registered: ${input.agentDidHex}`);
      if (!agent.operator.equals(publicKey)) {
        throw new Error('wallet is not the registered operator for this agent_did');
      }
      const ix = await buildCommitBidIx(program, cluster, {
        bidder: publicKey,
        task: input.task,
        taskId: input.taskId,
        paymentMint: input.paymentMint,
        bidderTokenAccount: input.bidderTokenAccount,
        agentOperator: agent.operator,
        agentId: agent.agentId,
        agentDid: hexToBytes(input.agentDidHex),
        commitHash: input.commitHash,
      });
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
      qc.invalidateQueries({ queryKey: ['bid-book'] });
      qc.invalidateQueries({ queryKey: ['bids-for-task'] });
      qc.invalidateQueries({ queryKey: ['bid'] });
    },
  });
}

export interface RevealBidArgs {
  task: PublicKey;
  taskId: Uint8Array;
  amount: bigint;
  nonce: Uint8Array;
}

export function useRevealBid() {
  const program = useTaskMarketProgram();
  const { connection } = useConnection();
  const { sendTransaction, publicKey } = useWallet();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: RevealBidArgs) => {
      if (!program) throw new Error('Wallet not connected');
      if (!publicKey) throw new Error('Missing wallet publicKey');
      const ix = await buildRevealBidIx(program, {
        bidder: publicKey,
        task: input.task,
        taskId: input.taskId,
        amount: input.amount,
        nonce: input.nonce,
      });
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
      qc.invalidateQueries({ queryKey: ['bid-book'] });
      qc.invalidateQueries({ queryKey: ['bids-for-task'] });
      qc.invalidateQueries({ queryKey: ['bid'] });
    },
  });
}

export interface ClaimBondArgs {
  task: PublicKey;
  taskId: Uint8Array;
  paymentMint: PublicKey;
  bidderTokenAccount: PublicKey;
  feeCollectorTokenAccount: PublicKey;
}

export function useClaimBond() {
  const program = useTaskMarketProgram();
  const { connection } = useConnection();
  const { sendTransaction, publicKey } = useWallet();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: ClaimBondArgs) => {
      if (!program) throw new Error('Wallet not connected');
      if (!publicKey) throw new Error('Missing wallet publicKey');
      const ix = await buildClaimBondIx(program, {
        bidder: publicKey,
        task: input.task,
        taskId: input.taskId,
        paymentMint: input.paymentMint,
        bidderTokenAccount: input.bidderTokenAccount,
        feeCollectorTokenAccount: input.feeCollectorTokenAccount,
      });
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
      qc.invalidateQueries({ queryKey: ['bid'] });
    },
  });
}
