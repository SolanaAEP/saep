'use client';

import { useQuery } from '@tanstack/react-query';
import { PublicKey } from '@solana/web3.js';
import {
  fetchAgentsByOperator,
  fetchAgentByDid,
  fetchTasksByAgent,
  fetchTreasury,
  fetchAllAgentsDetailed,
} from '@saep/sdk';
import { useAgentRegistryProgram, useTaskMarketProgram, useTreasuryProgram } from './program.js';

export function useAgentsByOperator(operator: PublicKey | null) {
  const program = useAgentRegistryProgram();
  return useQuery({
    queryKey: ['agents', operator?.toBase58()],
    enabled: Boolean(program && operator),
    queryFn: () => fetchAgentsByOperator(program!, operator!),
  });
}

export function useAgent(didHex: string | null) {
  const program = useAgentRegistryProgram();
  return useQuery({
    queryKey: ['agent', didHex],
    enabled: Boolean(program && didHex && didHex.length === 64),
    queryFn: () => fetchAgentByDid(program!, didHex!),
  });
}

export function useAgentTasks(didHex: string | null) {
  const program = useTaskMarketProgram();
  return useQuery({
    queryKey: ['agent-tasks', didHex],
    enabled: Boolean(program && didHex && didHex.length === 64),
    queryFn: () => fetchTasksByAgent(program!, didHex!),
  });
}

export function useAllAgents() {
  const program = useAgentRegistryProgram();
  return useQuery({
    queryKey: ['agents', 'all'],
    enabled: Boolean(program),
    queryFn: () => fetchAllAgentsDetailed(program!),
    staleTime: 30_000,
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
