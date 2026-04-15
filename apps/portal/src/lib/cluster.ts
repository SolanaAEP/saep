import { resolveCluster, type SaepCluster } from '@saep/sdk';

const rawCluster = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'devnet') as SaepCluster;
const endpoint = process.env.NEXT_PUBLIC_RPC_URL;

const programOverrides = {
  agentRegistry: process.env.NEXT_PUBLIC_PROGRAM_AGENT_REGISTRY,
  treasuryStandard: process.env.NEXT_PUBLIC_PROGRAM_TREASURY_STANDARD,
  taskMarket: process.env.NEXT_PUBLIC_PROGRAM_TASK_MARKET,
  capabilityRegistry: process.env.NEXT_PUBLIC_PROGRAM_CAPABILITY_REGISTRY,
  disputeArbitration: process.env.NEXT_PUBLIC_PROGRAM_DISPUTE_ARBITRATION,
  governanceProgram: process.env.NEXT_PUBLIC_PROGRAM_GOVERNANCE,
  feeCollector: process.env.NEXT_PUBLIC_PROGRAM_FEE_COLLECTOR,
  proofVerifier: process.env.NEXT_PUBLIC_PROGRAM_PROOF_VERIFIER,
};

const clean = Object.fromEntries(
  Object.entries(programOverrides).filter(([, v]) => Boolean(v)),
) as Record<string, string>;

export const clusterConfig = resolveCluster({
  cluster: rawCluster,
  endpoint,
  programIds: clean,
});

export const stakeMintAddress = process.env.NEXT_PUBLIC_STAKE_MINT ?? '';
