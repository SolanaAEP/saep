import { Connection, Keypair } from '@solana/web3.js';
import { AnchorProvider, type Wallet } from '@coral-xyz/anchor';
import {
  resolveCluster,
  agentRegistryProgram,
  taskMarketProgram,
  type ClusterConfig,
} from '@saep/sdk';
import type { Config } from './config.js';

export type BotContext = ReturnType<typeof createBotContext>;

export function createBotContext(cfg: Config) {
  const config = resolveCluster({
    cluster: cfg.cluster,
    endpoint: cfg.rpcUrl,
  });

  const connection = new Connection(cfg.rpcUrl, 'confirmed');
  const kp = Keypair.generate();
  const wallet: Wallet = {
    payer: kp,
    publicKey: kp.publicKey,
    signTransaction: async <T extends import('@solana/web3.js').Transaction | import('@solana/web3.js').VersionedTransaction>(tx: T) => tx,
    signAllTransactions: async <T extends import('@solana/web3.js').Transaction | import('@solana/web3.js').VersionedTransaction>(txs: T[]) => txs,
  };
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });

  return {
    connection,
    config,
    agentRegistry: agentRegistryProgram(provider, config),
    taskMarket: taskMarketProgram(provider, config),
    portalUrl: cfg.portalUrl,
  };
}
