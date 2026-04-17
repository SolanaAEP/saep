import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PublicKey } from '@solana/web3.js';
import { useConnection, useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { vi } from 'vitest';
import { ClusterContext } from '../hooks/cluster.js';

export const MOCK_PUBKEY = new PublicKey('11111111111111111111111111111112');
export const MOCK_PUBKEY_2 = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

export const MOCK_CLUSTER = {
  label: 'devnet' as const,
  endpoint: 'https://api.devnet.solana.com',
  programIds: {},
} as any;

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function createWrapper(qc?: QueryClient) {
  const client = qc ?? createQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ClusterContext.Provider value={MOCK_CLUSTER}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </ClusterContext.Provider>
    );
  };
}

export function mockConnection(overrides: Record<string, unknown> = {}) {
  const conn = {
    getLatestBlockhash: vi.fn().mockResolvedValue({
      blockhash: 'mock-blockhash',
      lastValidBlockHeight: 100,
    }),
    simulateTransaction: vi.fn().mockResolvedValue({
      value: { err: null, unitsConsumed: 200_000, logs: ['log1'] },
    }),
    confirmTransaction: vi.fn().mockResolvedValue({ value: {} }),
    _rpcEndpoint: 'https://rpc.example.com',
    ...overrides,
  };
  vi.mocked(useConnection).mockReturnValue({ connection: conn as any });
  return conn;
}

export function mockWallet(overrides: Record<string, unknown> = {}) {
  const wallet = {
    publicKey: MOCK_PUBKEY,
    sendTransaction: vi.fn().mockResolvedValue('mock-sig-abc123'),
    signTransaction: vi.fn().mockImplementation(async (tx: any) => tx),
    signAllTransactions: vi.fn(),
    wallet: null,
    connected: true,
    connecting: false,
    disconnect: vi.fn(),
    select: vi.fn(),
    wallets: [],
    ...overrides,
  };
  vi.mocked(useWallet).mockReturnValue(wallet as any);
  return wallet;
}

export function mockAnchorWallet() {
  const wallet = {
    publicKey: MOCK_PUBKEY,
    signTransaction: vi.fn().mockImplementation(async (tx: any) => tx),
    signAllTransactions: vi.fn().mockImplementation(async (txs: any[]) => txs),
  };
  vi.mocked(useAnchorWallet).mockReturnValue(wallet as any);
  return wallet;
}

export function mockProgram(methods: Record<string, unknown> = {}) {
  return {
    account: {},
    methods,
    programId: MOCK_PUBKEY,
    provider: { connection: {} },
  } as any;
}
