'use client';

import { useMemo } from 'react';
import { AnchorProvider, Program, Idl } from '@coral-xyz/anchor';
import {
  agentRegistryProgram,
  capabilityRegistryProgram,
  taskMarketProgram,
  proofVerifierProgram,
  treasuryStandardProgram,
  governanceProgramProgram,
  nxsStakingProgram,
  type ClusterConfig,
} from '@saep/sdk';
import { useAnchorProvider } from './provider.js';
import { useCluster } from './cluster.js';

type ProgramFactory<T extends Idl> = (provider: AnchorProvider, config: ClusterConfig) => Program<T>;

export function useProgram<T extends Idl>(factory: ProgramFactory<T>): Program<T> | null {
  const provider = useAnchorProvider();
  const cluster = useCluster();
  return useMemo(() => {
    if (!provider) return null;
    return factory(provider, cluster);
  }, [provider, cluster, factory]);
}

export function useAgentRegistryProgram() {
  return useProgram(agentRegistryProgram);
}

export function useCapabilityRegistryProgram() {
  return useProgram(capabilityRegistryProgram);
}

export function useTaskMarketProgram() {
  return useProgram(taskMarketProgram);
}

export function useProofVerifierProgram() {
  return useProgram(proofVerifierProgram);
}

export function useTreasuryProgram() {
  return useProgram(treasuryStandardProgram);
}

export function useGovernanceProgram() {
  return useProgram(governanceProgramProgram);
}

export function useNxsStakingProgram() {
  return useProgram(nxsStakingProgram);
}
