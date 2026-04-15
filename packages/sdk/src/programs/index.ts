import { AnchorProvider, Program, Idl } from '@coral-xyz/anchor';
import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

import agentRegistryIdl from '../idl/agent_registry.json' with { type: 'json' };
import treasuryStandardIdl from '../idl/treasury_standard.json' with { type: 'json' };
import type { AgentRegistry } from '../generated/agent_registry.js';
import type { TreasuryStandard } from '../generated/treasury_standard.js';
import type { ClusterConfig } from '../cluster/index.js';

export interface BrowserWallet {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}

export interface ProviderInput {
  connection: Connection;
  wallet: BrowserWallet;
}

export function makeProvider({ connection, wallet }: ProviderInput): AnchorProvider {
  return new AnchorProvider(connection, wallet as unknown as AnchorProvider['wallet'], {
    commitment: 'confirmed',
  });
}

export function agentRegistryProgram(
  provider: AnchorProvider,
  config: ClusterConfig,
): Program<AgentRegistry> {
  const idl = { ...(agentRegistryIdl as Idl), address: config.programIds.agentRegistry.toBase58() };
  return new Program<AgentRegistry>(idl as unknown as AgentRegistry, provider);
}

export function treasuryStandardProgram(
  provider: AnchorProvider,
  config: ClusterConfig,
): Program<TreasuryStandard> {
  const idl = { ...(treasuryStandardIdl as Idl), address: config.programIds.treasuryStandard.toBase58() };
  return new Program<TreasuryStandard>(idl as unknown as TreasuryStandard, provider);
}

export type { AgentRegistry, TreasuryStandard };
export { PublicKey };
