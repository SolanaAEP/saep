'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PublicKey, Transaction } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { fetchTaskById, fetchTasksByClient, buildRaiseDisputeIx } from '@saep/sdk';
import { useTaskMarketProgram } from './program.js';

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
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      return sig;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task'] });
    },
  });
}
