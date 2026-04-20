'use client';

import { useState } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClusterContext } from '@saep/sdk-ui';
import { clusterConfig } from '@/lib/cluster';

const WALLETS: never[] = [];

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient());

  return (
    <ClusterContext.Provider value={clusterConfig}>
      <ConnectionProvider endpoint={clusterConfig.endpoint}>
        <WalletProvider wallets={WALLETS} autoConnect>
          <WalletModalProvider>
            <QueryClientProvider client={qc}>{children}</QueryClientProvider>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </ClusterContext.Provider>
  );
}
