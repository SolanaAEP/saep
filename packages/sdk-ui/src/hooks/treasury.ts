'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PublicKey, Transaction } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  fetchAllowedMints,
  fetchStreamsByAgent,
  fetchVaultBalances,
  buildSetLimitsIx,
  type SetLimitsInput,
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
