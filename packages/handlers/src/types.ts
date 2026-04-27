import type { AnchorProvider } from '@coral-xyz/anchor';
import type { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import type { ClusterConfig, SaepCluster } from '@saep/sdk';

export type { SaepCluster, ClusterConfig };

export interface Wallet {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions?<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}

export interface HandlerContext {
  cluster: SaepCluster;
  config: ClusterConfig;
  provider: AnchorProvider;
  operator: PublicKey;
  connection: Connection;
}

export type HandlerResult = {
  cluster: SaepCluster;
  error?: string;
  reason?: string;
  signature?: string;
  warning?: string;
  [key: string]: unknown;
};
