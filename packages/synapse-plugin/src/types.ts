import type { Connection } from '@solana/web3.js';
import type { Wallet, SaepCluster } from '@saep/handlers';
import type { SynapseClient, SynapseClientOptions } from './synapse-types.js';

export interface SynapsePluginOptions {
  cluster?: SaepCluster;
  connection: Connection;
  wallet: Wallet;
  synapse: SynapseClient | SynapseClientOptions;
  discoveryUrl?: string;
  maxAutoSignLamports?: number;
  velocityLimit?: number;
}

export interface NonceEntry {
  taskAddress: string;
  taskIdHex: string;
  agentDidHex: string;
  amountUsdcMicro: number;
  nonceHex: string;
  createdAt: number;
}

export interface NonceStore {
  save(entry: NonceEntry): Promise<void>;
  get(taskAddress: string): Promise<NonceEntry | null>;
  delete(taskAddress: string): Promise<void>;
  list(): Promise<NonceEntry[]>;
}
