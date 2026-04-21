'use client';

import { ConnectionProvider } from '@solana/wallet-adapter-react';
import { ClusterContext } from '@saep/sdk-ui';
import { stakingClusterConfig } from '@/lib/cluster';
import { StakingShell } from './staking-shell';

export default function StakingClientPage() {
  return (
    <ClusterContext.Provider value={stakingClusterConfig}>
      <ConnectionProvider endpoint={stakingClusterConfig.endpoint}>
        <StakingShell />
      </ConnectionProvider>
    </ClusterContext.Provider>
  );
}
