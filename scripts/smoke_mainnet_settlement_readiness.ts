import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair } from '@solana/web3.js';
import {
  fetchMarketGlobal,
  fetchProofVerifierAllowedCallers,
  fetchVerifierConfig,
  fetchVerifierKey,
  fetchVerifierMode,
  proofVerifierProgram,
  resolveCluster,
  taskMarketProgram,
  verifierKeyPda,
  type SaepCluster,
  type SaepProgramName,
} from '@saep/sdk';
import {
  computeTaskCompletionVkId,
  evaluateSettlementReadiness,
} from '../packages/sdk-ui/src/settlement.ts';

const PROGRAM_ENV: Partial<Record<SaepProgramName, string | undefined>> = {
  agentRegistry: process.env.NEXT_PUBLIC_PROGRAM_AGENT_REGISTRY,
  treasuryStandard: process.env.NEXT_PUBLIC_PROGRAM_TREASURY_STANDARD,
  taskMarket: process.env.NEXT_PUBLIC_PROGRAM_TASK_MARKET,
  disputeArbitration: process.env.NEXT_PUBLIC_PROGRAM_DISPUTE_ARBITRATION,
  governanceProgram: process.env.NEXT_PUBLIC_PROGRAM_GOVERNANCE,
  feeCollector: process.env.NEXT_PUBLIC_PROGRAM_FEE_COLLECTOR,
  proofVerifier: process.env.NEXT_PUBLIC_PROGRAM_PROOF_VERIFIER,
  capabilityRegistry: process.env.NEXT_PUBLIC_PROGRAM_CAPABILITY_REGISTRY,
  nxsStaking: process.env.NEXT_PUBLIC_PROGRAM_NXS_STAKING,
  templateRegistry: process.env.NEXT_PUBLIC_PROGRAM_TEMPLATE_REGISTRY,
};

function cleanProgramOverrides() {
  return Object.fromEntries(
    Object.entries(PROGRAM_ENV).filter(([, value]) => Boolean(value)),
  ) as Partial<Record<SaepProgramName, string>>;
}

function proofGenBaseUrl(): string {
  const value =
    process.env.PROOFGEN_API_URL
    ?? process.env.PROOF_GEN_API_URL
    ?? process.env.PROOFGEN_URL;
  if (!value) throw new Error('PROOFGEN_API_URL is required for settlement readiness smoke');
  return value.replace(/\/$/, '');
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function main() {
  const cluster = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'mainnet-beta') as SaepCluster;
  if (cluster !== 'mainnet-beta') {
    throw new Error(`settlement readiness smoke must target mainnet-beta, got ${cluster}`);
  }

  const config = resolveCluster({
    cluster,
    endpoint:
      process.env.NEXT_PUBLIC_RPC_URL
      ?? process.env.SOLANA_RPC_URL
      ?? process.env.ANCHOR_PROVIDER_URL,
    programIds: cleanProgramOverrides(),
  });
  const connection = new Connection(config.endpoint, 'confirmed');
  const provider = new AnchorProvider(connection, new Wallet(Keypair.generate()), {
    commitment: 'confirmed',
  });
  const taskMarket = taskMarketProgram(provider, config);
  const proofVerifier = proofVerifierProgram(provider, config);
  const vkId = await computeTaskCompletionVkId();
  const [expectedVerifierKey] = verifierKeyPda(config.programIds.proofVerifier, vkId);
  const proofGen = proofGenBaseUrl();

  const [
    market,
    verifierMode,
    verifierConfig,
    allowedCallers,
    activeVerifierKey,
    proofGenHealth,
    proofGenCircuits,
  ] = await Promise.all([
    fetchMarketGlobal(taskMarket),
    fetchVerifierMode(proofVerifier),
    fetchVerifierConfig(proofVerifier),
    fetchProofVerifierAllowedCallers(proofVerifier),
    fetchVerifierKey(proofVerifier, vkId),
    fetchJson<{ ok?: boolean; artifacts?: string; verification_key?: string; circuits?: string[] }>(
      `${proofGen}/healthz`,
    ),
    fetchJson<{ circuits?: Array<{
      circuit_id: string;
      slug?: string;
      lifecycle?: string;
      verifier?: string;
      verification_key_version?: number;
      public_inputs?: string[];
      artifacts?: string;
      verification_key?: string;
    }> }>(`${proofGen}/circuits`),
  ]);

  const readiness = evaluateSettlementReadiness({
    taskMarketProgramId: config.programIds.taskMarket.toBase58(),
    expectedVerifierKeyAddress: expectedVerifierKey.toBase58(),
    market: market
      ? { paused: market.paused, proofVerifier: market.proofVerifier.toBase58() }
      : null,
    verifierMode,
    verifierConfig: verifierConfig
      ? { paused: verifierConfig.paused, activeVk: verifierConfig.activeVk.toBase58() }
      : null,
    activeVerifierKey: activeVerifierKey
      ? {
          address: activeVerifierKey.address.toBase58(),
          isProduction: activeVerifierKey.isProduction,
          circuitLabel: activeVerifierKey.circuitLabel,
          numPublicInputs: activeVerifierKey.numPublicInputs,
        }
      : null,
    allowedCallers: allowedCallers
      ? { programs: allowedCallers.programs.map((program) => program.toBase58()) }
      : null,
    proofGenHealth,
    proofGenCircuits,
  });

  for (const check of readiness.checks) {
    const icon = check.ok ? 'OK' : 'FAIL';
    console.log(`${icon.padEnd(4)} ${check.label}: ${check.detail}`);
  }

  if (!readiness.ready) {
    process.exitCode = 1;
    console.error('mainnet settlement readiness failed');
    return;
  }
  console.log('mainnet settlement readiness passed');
}

main().catch((error) => {
  process.exitCode = 1;
  console.error(error instanceof Error ? error.message : error);
});
