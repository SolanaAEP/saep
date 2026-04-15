'use client';

import { useMemo, useState } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClusterContext } from '@saep/sdk-ui';
import { clusterConfig } from '@/lib/cluster';
import '@solana/wallet-adapter-react-ui/styles.css';

export function AppProviders({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  const [qc] = useState(() => new QueryClient());

  return (
    <ClusterContext.Provider value={clusterConfig}>
      <ConnectionProvider endpoint={clusterConfig.endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <QueryClientProvider client={qc}>{children}</QueryClientProvider>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </ClusterContext.Provider>
  );
}

export { AppProviders as WalletProviders };
