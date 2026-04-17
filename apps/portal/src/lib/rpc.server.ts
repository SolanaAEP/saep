import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { AnchorProvider, type Wallet } from '@coral-xyz/anchor';
import {
  agentRegistryProgram,
  taskMarketProgram,
  treasuryStandardProgram,
} from '@saep/sdk';
import { clusterConfig } from './cluster';

const dummyKeypair = Keypair.generate();
const readOnlyWallet: Wallet = {
  payer: dummyKeypair,
  publicKey: dummyKeypair.publicKey,
  signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => tx,
  signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => txs,
};

function readOnlyProvider() {
  const conn = new Connection(clusterConfig.endpoint, 'confirmed');
  return new AnchorProvider(conn, readOnlyWallet, { commitment: 'confirmed' });
}

export function getAgentRegistryProgram() {
  return agentRegistryProgram(readOnlyProvider(), clusterConfig);
}

export function getTaskMarketProgram() {
  return taskMarketProgram(readOnlyProvider(), clusterConfig);
}

export function getTreasuryProgram() {
  return treasuryStandardProgram(readOnlyProvider(), clusterConfig);
}
