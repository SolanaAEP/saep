import type { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import type { z } from 'zod';

export type SakCluster = 'devnet' | 'mainnet-beta' | 'localnet';

export type SakWallet = {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
};

export type SakAgentLike = {
  wallet: SakWallet;
  connection: Connection;
};

export type Action<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  similes: string[];
  description: string;
  examples: Array<{ input: string; output: string }>;
  schema: S;
  handler: (agent: SakAgentLike, input: z.infer<S>) => Promise<unknown>;
};
