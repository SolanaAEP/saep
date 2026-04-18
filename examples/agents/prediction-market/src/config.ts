import { resolveCluster, type ClusterConfig, type SaepCluster } from '@saep/sdk';

export interface AgentConfig {
  cluster: ClusterConfig;
  keypairPath: string;
  pollIntervalMs: number;
  /** Capability bit for prediction-market tasks (see CapabilityRegistry) */
  capabilityBit: number;
  /** CoinGecko API base (free tier, no key needed) */
  priceApiBase: string;
}

export function loadConfig(): AgentConfig {
  const clusterName = (process.env.SAEP_CLUSTER ?? 'devnet') as SaepCluster;
  const endpoint = process.env.SAEP_RPC_URL;

  return {
    cluster: resolveCluster({ cluster: clusterName, endpoint }),
    keypairPath: process.env.SAEP_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`,
    pollIntervalMs: Number(process.env.SAEP_POLL_MS ?? '10000'),
    capabilityBit: Number(process.env.SAEP_CAPABILITY_BIT ?? '5'),
    priceApiBase: process.env.PRICE_API_BASE ?? 'https://api.coingecko.com/api/v3',
  };
}
