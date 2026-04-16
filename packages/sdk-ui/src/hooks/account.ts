'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, type AccountInfo, type Commitment } from '@solana/web3.js';
import { BorshAccountsCoder, Idl, Program } from '@coral-xyz/anchor';

export interface UseAccountOptions {
  commitment?: Commitment;
  subscribe?: boolean;
  staleTime?: number;
}

export function useAccountInfo(
  address: PublicKey | null,
  opts: UseAccountOptions = {},
): UseQueryResult<AccountInfo<Buffer> | null> {
  const { connection } = useConnection();
  const qc = useQueryClient();
  const { commitment = 'confirmed', subscribe = true, staleTime = 10_000 } = opts;
  const key = address?.toBase58() ?? null;

  useEffect(() => {
    if (!key || !subscribe) return;
    const addr = new PublicKey(key);
    const subId = connection.onAccountChange(addr, (info) => {
      qc.setQueryData(['account', key], info);
    }, commitment);
    return () => { connection.removeAccountChangeListener(subId); };
  }, [connection, key, subscribe, commitment, qc]);

  return useQuery({
    queryKey: ['account', key],
    enabled: Boolean(key),
    staleTime,
    queryFn: () => connection.getAccountInfo(new PublicKey(key!), commitment),
  });
}

export interface UseDecodedAccountOptions<T> extends UseAccountOptions {
  coder: BorshAccountsCoder;
  accountName: string;
  transform?: (raw: Record<string, unknown>) => T;
}

export function useDecodedAccount<T>(
  address: PublicKey | null,
  opts: UseDecodedAccountOptions<T>,
): UseQueryResult<T | null> {
  const { connection } = useConnection();
  const qc = useQueryClient();
  const { commitment = 'confirmed', subscribe = true, staleTime = 10_000, coder, accountName, transform } = opts;
  const key = address?.toBase58() ?? null;

  useEffect(() => {
    if (!key || !subscribe) return;
    const addr = new PublicKey(key);
    const subId = connection.onAccountChange(addr, (info) => {
      try {
        const decoded = coder.decode(accountName, info.data);
        const value = transform ? transform(decoded) : decoded as T;
        qc.setQueryData(['account-decoded', accountName, key], value);
      } catch { /* skip decode errors from partial updates */ }
    }, commitment);
    return () => { connection.removeAccountChangeListener(subId); };
  }, [connection, key, subscribe, commitment, qc, coder, accountName, transform]);

  return useQuery({
    queryKey: ['account-decoded', accountName, key],
    enabled: Boolean(key),
    staleTime,
    queryFn: async () => {
      const info = await connection.getAccountInfo(new PublicKey(key!), commitment);
      if (!info) return null;
      const decoded = coder.decode(accountName, info.data);
      return transform ? transform(decoded) : decoded as T;
    },
  });
}

export function useAnchorAccount<T extends Idl>(
  program: Program<T> | null,
  accountName: string,
  address: PublicKey | null,
  opts: Omit<UseAccountOptions, never> = {},
): UseQueryResult<Record<string, unknown> | null> {
  const { connection } = useConnection();
  const qc = useQueryClient();
  const { commitment = 'confirmed', subscribe = true, staleTime = 10_000 } = opts;
  const key = address?.toBase58() ?? null;
  const programId = program?.programId.toBase58() ?? null;

  useEffect(() => {
    if (!key || !subscribe || !program) return;
    const addr = new PublicKey(key);
    const subId = connection.onAccountChange(addr, (info) => {
      try {
        const decoded = program.coder.accounts.decode(accountName, info.data);
        qc.setQueryData(['anchor-account', programId, accountName, key], decoded);
      } catch { /* skip decode errors */ }
    }, commitment);
    return () => { connection.removeAccountChangeListener(subId); };
  }, [connection, key, subscribe, commitment, qc, program, programId, accountName]);

  return useQuery({
    queryKey: ['anchor-account', programId, accountName, key],
    enabled: Boolean(key && program),
    staleTime,
    queryFn: async () => {
      const account = (program!.account as Record<string, { fetchNullable: (addr: PublicKey) => Promise<unknown> }>);
      const camelName = accountName.charAt(0).toLowerCase() + accountName.slice(1);
      const accessor = account[camelName] ?? account[accountName];
      if (!accessor) throw new Error(`Unknown account type: ${accountName}`);
      return (await accessor.fetchNullable(new PublicKey(key!))) as Record<string, unknown> | null;
    },
  });
}
