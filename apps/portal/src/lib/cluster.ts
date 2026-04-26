import { resolveCluster, type SaepCluster } from '@saep/sdk';

const MAINNET_NXS_STAKING_PROGRAM_ID = 'GjXfJ6MHb6SJ4XBK3qcpGw4n256qYPrDcXrNj6kf2i2Z';
const MAINNET_SAEP_STAKE_MINT = 'HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump';
const MAINNET_STAKING_RPC_URL = 'https://solana-rpc.publicnode.com';
const DEPRECATED_STAKING_RPC_PREFIX = 'https://mainnet.helius-rpc.com/?api-key=';

function cleanProgramOverrides(overrides: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => Boolean(value)),
  ) as Record<string, string>;
}

function cleanStakingEndpoint(endpoint: string | undefined) {
  if (!endpoint) return undefined;
  return endpoint.startsWith(DEPRECATED_STAKING_RPC_PREFIX) ? MAINNET_STAKING_RPC_URL : endpoint;
}

const rawCluster = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'devnet') as SaepCluster;
const endpoint = process.env.NEXT_PUBLIC_RPC_URL;

const programOverrides = cleanProgramOverrides({
  agentRegistry: process.env.NEXT_PUBLIC_PROGRAM_AGENT_REGISTRY,
  treasuryStandard: process.env.NEXT_PUBLIC_PROGRAM_TREASURY_STANDARD,
  taskMarket: process.env.NEXT_PUBLIC_PROGRAM_TASK_MARKET,
  capabilityRegistry: process.env.NEXT_PUBLIC_PROGRAM_CAPABILITY_REGISTRY,
  disputeArbitration: process.env.NEXT_PUBLIC_PROGRAM_DISPUTE_ARBITRATION,
  governanceProgram: process.env.NEXT_PUBLIC_PROGRAM_GOVERNANCE,
  feeCollector: process.env.NEXT_PUBLIC_PROGRAM_FEE_COLLECTOR,
  proofVerifier: process.env.NEXT_PUBLIC_PROGRAM_PROOF_VERIFIER,
  nxsStaking: process.env.NEXT_PUBLIC_PROGRAM_NXS_STAKING,
  templateRegistry: process.env.NEXT_PUBLIC_PROGRAM_TEMPLATE_REGISTRY,
});

export const clusterConfig = resolveCluster({
  cluster: rawCluster,
  endpoint,
  programIds: programOverrides,
});

const globalStakeMint = process.env.NEXT_PUBLIC_STAKE_MINT;
const stakingCluster = (process.env.NEXT_PUBLIC_STAKING_CLUSTER ?? 'mainnet-beta') as SaepCluster;
const stakingEndpoint =
  cleanStakingEndpoint(process.env.NEXT_PUBLIC_STAKING_RPC_URL) ??
  cleanStakingEndpoint(stakingCluster === rawCluster
    ? endpoint
    : stakingCluster === 'mainnet-beta'
      ? MAINNET_STAKING_RPC_URL
      : undefined);

const stakingProgramOverrides = cleanProgramOverrides({
  ...programOverrides,
  nxsStaking:
    process.env.NEXT_PUBLIC_STAKING_PROGRAM_NXS_STAKING ??
    process.env.NEXT_PUBLIC_PROGRAM_NXS_STAKING ??
    (stakingCluster === 'mainnet-beta' ? MAINNET_NXS_STAKING_PROGRAM_ID : undefined),
});

export const stakingClusterConfig = resolveCluster({
  cluster: stakingCluster,
  endpoint: stakingEndpoint,
  programIds: stakingProgramOverrides,
});

export const stakeMintAddress = globalStakeMint ?? '';
export const stakingStakeMintAddress =
  process.env.NEXT_PUBLIC_STAKING_STAKE_MINT ??
  globalStakeMint ??
  (stakingCluster === 'mainnet-beta' ? MAINNET_SAEP_STAKE_MINT : '');
