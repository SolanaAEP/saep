'use client';

import { useCallback } from 'react';
import {
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
} from '@tanstack/react-query';
import {
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  JitoBundleSubmitter,
  type InflightBundleStatus,
} from '@saep/sdk';

export interface SettlementBundleResult {
  bundleId: string;
  inflightStatus?: InflightBundleStatus;
}

export interface UseSettlementBundleOptions<TInput> {
  submitter: JitoBundleSubmitter;
  bundleBuilder: (input: TInput) => Promise<(Transaction | VersionedTransaction)[]>;
  invalidateKeys?: QueryKey[];
  pollInflight?: boolean;
}

/**
 * Parallel to `useSendTransaction` but for Jito bundles. The builder returns
 * a signed-or-signable tx list; the caller is responsible for providing
 * pre-signed VersionedTransactions (bundles don't round-trip through the
 * wallet-adapter signAllTransactions path cleanly, so most callers will
 * pre-sign inside `bundleBuilder`).
 */
export function useSettlementBundle<TInput>(
  opts: UseSettlementBundleOptions<TInput>,
  mutationOpts?: Omit<
    UseMutationOptions<SettlementBundleResult, Error, TInput>,
    'mutationFn'
  >,
) {
  const { connection: _connection } = useConnection();
  const { publicKey } = useWallet();
  const qc = useQueryClient();

  const mutationFn = useCallback(
    async (input: TInput): Promise<SettlementBundleResult> => {
      if (!publicKey) throw new Error('Wallet not connected');
      const txs = await opts.bundleBuilder(input);
      if (txs.length === 0) throw new Error('bundleBuilder returned no txs');

      const bundleId = await opts.submitter.submitBundle(txs);

      let inflightStatus: InflightBundleStatus | undefined;
      if (opts.pollInflight) {
        inflightStatus = await opts.submitter.getInflightBundleStatus(bundleId);
      }
      return { bundleId, inflightStatus };
    },
    [opts, publicKey],
  );

  return useMutation<SettlementBundleResult, Error, TInput>({
    ...mutationOpts,
    mutationFn,
    onSuccess: (data, input, context) => {
      if (opts.invalidateKeys) {
        for (const key of opts.invalidateKeys) {
          qc.invalidateQueries({ queryKey: key });
        }
      }
      mutationOpts?.onSuccess?.(data, input, context);
    },
  });
}
