'use client';

import { useMemo } from 'react';
import { useConnection, useAnchorWallet } from '@solana/wallet-adapter-react';
import {
  agentRegistryProgram,
  makeProvider,
  treasuryStandardProgram,
} from '@saep/sdk';
import { useCluster } from './cluster.js';

export function useAgentRegistryProgram() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const cluster = useCluster();
  return useMemo(() => {
    if (!wallet) return null;
    return agentRegistryProgram(makeProvider({ connection, wallet }), cluster);
  }, [connection, wallet, cluster]);
}

export function useTreasuryProgram() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const cluster = useCluster();
  return useMemo(() => {
    if (!wallet) return null;
    return treasuryStandardProgram(makeProvider({ connection, wallet }), cluster);
  }, [connection, wallet, cluster]);
}
