import type { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import type { z } from 'zod';
import type { SaepCluster } from '@saep/sdk';

export type SakCluster = SaepCluster;

export type SakWallet = {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions?<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
};

export type SakAgentLike = {
  wallet: SakWallet;
  connection: Connection;
};

export type SaepPluginOptions = {
  maxAutoSignLamports?: number;
  velocityLimit?: number;
};

export type Action<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  similes: string[];
  description: string;
  examples: Array<{ input: string; output: string }>;
  schema: S;
  handler: (agent: SakAgentLike, input: z.infer<S>) => Promise<Record<string, unknown>>;
};
