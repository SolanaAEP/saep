'use client';

import { useCallback, useRef } from 'react';
import {
  useMutation,
  useQueryClient,
  type QueryKey,
  type QueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query';
import {
  Transaction,
  TransactionInstruction,
  type Connection,
  type SimulatedTransactionResponse,
  type TransactionSignature,
} from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  StakedRpcSubmitter,
  clampPriorityFee,
  getHeliusPriorityFeeEstimate,
  withPriorityFee,
  type PriorityLevel,
} from '@saep/sdk';

export interface SimulationResult {
  slot: number;
  unitsConsumed: number | undefined;
  logs: string[];
}

export interface MutationResult {
  signature: TransactionSignature;
  simulation: SimulationResult;
}

export interface OptimisticUpdate<TInput> {
  queryKey: QueryKey;
  updater: (old: unknown, input: TInput) => unknown;
}

export interface PriorityFeeConfig {
  microLamports?: number;
  cuLimit?: number;
  level?: PriorityLevel;
  cap?: number;
  floor?: number;
  estimateUrl?: string;
}

export interface UseSendTransactionOptions<TInput> {
  buildInstruction: (input: TInput) => Promise<TransactionInstruction | TransactionInstruction[]>;
  invalidateKeys?: QueryKey[];
  optimisticUpdates?: OptimisticUpdate<TInput>[];
  onSimulated?: (sim: SimulationResult, input: TInput) => void;
  commitment?: 'processed' | 'confirmed' | 'finalized';
  submitter?: StakedRpcSubmitter;
  priorityFee?: PriorityFeeConfig | 'auto';
}

function parseSimulation(response: SimulatedTransactionResponse): SimulationResult {
  return {
    slot: 0,
    unitsConsumed: response.unitsConsumed ?? undefined,
    logs: response.logs ?? [],
  };
}

async function simulateAndSend(
  connection: Connection,
  tx: Transaction,
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<TransactionSignature>,
  signTransaction: ((tx: Transaction) => Promise<Transaction>) | undefined,
  submitter?: StakedRpcSubmitter,
): Promise<{ signature: TransactionSignature; simulation: SimulationResult }> {
  const simResult = await connection.simulateTransaction(tx);
  if (simResult.value.err) {
    const logs = simResult.value.logs?.join('\n') ?? '';
    throw new SimulationError(simResult.value.err, logs);
  }
  const simulation = parseSimulation(simResult.value);

  let signature: TransactionSignature;
  if (submitter && signTransaction) {
    const signed = await signTransaction(tx);
    signature = await submitter.submit(signed);
  } else {
    signature = await sendTransaction(tx, connection);
  }
  return { signature, simulation };
}

async function applyPriorityFee(
  connection: Connection,
  tx: Transaction,
  config: PriorityFeeConfig | 'auto' | undefined,
): Promise<void> {
  if (!config) return;
  const cfg: PriorityFeeConfig = config === 'auto' ? {} : config;
  let microLamports = cfg.microLamports;
  if (microLamports == null) {
    const url = cfg.estimateUrl ?? (connection as { _rpcEndpoint?: string })._rpcEndpoint;
    if (!url) return;
    try {
      const est = await getHeliusPriorityFeeEstimate(
        url,
        tx.serialize({ verifySignatures: false, requireAllSignatures: false }),
        cfg.level ?? 'Medium',
      );
      microLamports = est.microLamports;
    } catch {
      microLamports = 0;
    }
  }
  microLamports = clampPriorityFee(microLamports, { cap: cfg.cap, floor: cfg.floor });
  if (microLamports > 0 || cfg.cuLimit != null) {
    withPriorityFee(tx, microLamports, cfg.cuLimit);
  }
}

export class SimulationError extends Error {
  constructor(
    public readonly err: unknown,
    public readonly logs: string,
  ) {
    super(`Transaction simulation failed: ${JSON.stringify(err)}\n${logs}`);
    this.name = 'SimulationError';
  }
}

function rollback(qc: QueryClient, snapshots: Map<string, unknown>) {
  for (const [key, data] of snapshots) {
    qc.setQueryData(JSON.parse(key), data);
  }
}

export function useSendTransaction<TInput>(
  opts: UseSendTransactionOptions<TInput>,
  mutationOpts?: Omit<UseMutationOptions<MutationResult, Error, TInput>, 'mutationFn'>,
) {
  const { connection } = useConnection();
  const { sendTransaction, signTransaction, publicKey } = useWallet();
  const qc = useQueryClient();
  const snapshotsRef = useRef<Map<string, unknown>>(new Map());

  const mutationFn = useCallback(
    async (input: TInput): Promise<MutationResult> => {
      if (!publicKey) throw new Error('Wallet not connected');

      const ixResult = await opts.buildInstruction(input);
      const instructions = Array.isArray(ixResult) ? ixResult : [ixResult];

      const tx = new Transaction();
      for (const ix of instructions) tx.add(ix);

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      await applyPriorityFee(connection, tx, opts.priorityFee);

      const { signature, simulation } = await simulateAndSend(
        connection,
        tx,
        sendTransaction,
        signTransaction,
        opts.submitter,
      );

      opts.onSimulated?.(simulation, input);

      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        opts.commitment ?? 'confirmed',
      );

      return { signature, simulation };
    },
    [connection, publicKey, sendTransaction, signTransaction, opts],
  );

  return useMutation<MutationResult, Error, TInput>({
    ...mutationOpts,
    mutationFn,
    onMutate: async (input) => {
      const snapshots = new Map<string, unknown>();
      snapshotsRef.current = snapshots;

      if (opts.optimisticUpdates) {
        for (const update of opts.optimisticUpdates) {
          await qc.cancelQueries({ queryKey: update.queryKey });
          const prev = qc.getQueryData(update.queryKey);
          snapshots.set(JSON.stringify(update.queryKey), prev);
          qc.setQueryData(update.queryKey, (old: unknown) => update.updater(old, input));
        }
      }

      await mutationOpts?.onMutate?.(input);
    },
    onError: (error, input, context) => {
      rollback(qc, snapshotsRef.current);
      mutationOpts?.onError?.(error, input, context);
    },
    onSuccess: (data, input, context) => {
      if (opts.invalidateKeys) {
        for (const key of opts.invalidateKeys) {
          qc.invalidateQueries({ queryKey: key });
        }
      }
      mutationOpts?.onSuccess?.(data, input, context);
    },
    onSettled: (data, error, input, context) => {
      snapshotsRef.current.clear();
      mutationOpts?.onSettled?.(data, error, input, context);
    },
  });
}
