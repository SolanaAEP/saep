import { Cluster, Connection, clusterApiUrl, PublicKey } from '@solana/web3.js';

export type SaepCluster = 'devnet' | 'mainnet-beta' | 'localnet';

export const DEVNET_PROGRAM_IDS = {
  agentRegistry: 'EQJ4Lp2gxJDD5hs185aDcermYWdAi4cQeSKfnuqLAQYu',
  treasuryStandard: '6boJQg4L6FRS7YZ5rFXfKUaXSy3eCKnW2SdrT3LJLizQ',
  taskMarket: 'HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w',
  disputeArbitration: 'GM8xiT17USBpCW24XXBmUR8YVCxxrJPMEcsddwfUokMa',
  governanceProgram: '9uczLDZaN9EWqW76be75ji4vCsz3cydefbChqvBS6qw1',
  feeCollector: '4xLpFgjpZwJbf61UyvyMhmEBmeJzPaCyKvZeYuK2YFFu',
  proofVerifier: 'DcJx1p6bcNuFm4i5WMgK4uGZitc1bf4Ubc5d4sctZKVe',
  capabilityRegistry: 'GW161Wce7z4S2rdcSCPNGixn2YQajefNc4r3jUj9zZ5F',
} as const;

export type SaepProgramName = keyof typeof DEVNET_PROGRAM_IDS;
export type ProgramIdMap = Record<SaepProgramName, PublicKey>;

export interface ClusterConfig {
  cluster: SaepCluster;
  endpoint: string;
  programIds: ProgramIdMap;
}

const toPubkeyMap = (raw: Record<SaepProgramName, string>): ProgramIdMap =>
  Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, new PublicKey(v)]),
  ) as ProgramIdMap;

export function resolveCluster(input?: {
  cluster?: SaepCluster;
  endpoint?: string;
  programIds?: Partial<Record<SaepProgramName, string>>;
}): ClusterConfig {
  const cluster = (input?.cluster ?? 'devnet') as SaepCluster;
  const endpoint =
    input?.endpoint ??
    (cluster === 'localnet' ? 'http://127.0.0.1:8899' : clusterApiUrl(cluster as Cluster));
  const merged = { ...DEVNET_PROGRAM_IDS, ...(input?.programIds ?? {}) } as Record<SaepProgramName, string>;
  return { cluster, endpoint, programIds: toPubkeyMap(merged) };
}

export function connectionFor(config: ClusterConfig): Connection {
  return new Connection(config.endpoint, 'confirmed');
}
