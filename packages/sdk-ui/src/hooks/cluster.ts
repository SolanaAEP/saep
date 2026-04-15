'use client';

import { createContext, useContext } from 'react';
import type { ClusterConfig } from '@saep/sdk';

export const ClusterContext = createContext<ClusterConfig | null>(null);

export function useCluster(): ClusterConfig {
  const ctx = useContext(ClusterContext);
  if (!ctx) throw new Error('useCluster must be used inside <ClusterProvider>');
  return ctx;
}
