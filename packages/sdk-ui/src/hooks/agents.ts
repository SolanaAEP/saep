'use client';

import { useQuery } from '@tanstack/react-query';
import { PublicKey } from '@solana/web3.js';
import { fetchAgentsByOperator, fetchTreasury } from '@saep/sdk';
import { useAgentRegistryProgram, useTreasuryProgram } from './program.js';

export function useAgentsByOperator(operator: PublicKey | null) {
  const program = useAgentRegistryProgram();
  return useQuery({
    queryKey: ['agents', operator?.toBase58()],
    enabled: Boolean(program && operator),
    queryFn: () => fetchAgentsByOperator(program!, operator!),
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
