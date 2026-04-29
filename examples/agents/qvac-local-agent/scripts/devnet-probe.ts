// Inspect devnet state relevant to running the QVAC agent end-to-end:
// - operator's existing agents (if any)
// - active VerifierKey on proof_verifier
// - market_global account presence

import { readFileSync } from 'node:fs';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair } from '@solana/web3.js';
import {
  agentRegistryProgram,
  fetchAgentsByOperator,
  fetchMarketGlobal,
  proofVerifierProgram,
  resolveCluster,
  taskMarketProgram,
} from '@saep/sdk';
import { fetchActiveVerifierKey } from '../src/onchain-verify.js';

async function main() {
  const keypairPath = process.env.SAEP_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`;
  const keypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf8'))),
  );
  console.log(`[probe] operator: ${keypair.publicKey.toBase58()}`);

  const cluster = resolveCluster({ cluster: 'devnet', endpoint: process.env.SAEP_RPC_URL });
  console.log(`[probe] endpoint: ${cluster.endpoint}`);
  const connection = new Connection(cluster.endpoint, 'confirmed');
  const provider = new AnchorProvider(connection, new Wallet(keypair), { commitment: 'confirmed' });

  const balance = await connection.getBalance(keypair.publicKey);
  console.log(`[probe] devnet SOL: ${balance / 1e9}`);

  console.log('\n[probe] === agent_registry ===');
  const registry = agentRegistryProgram(provider, cluster);
  const myAgents = await fetchAgentsByOperator(registry, keypair.publicKey);
  console.log(`[probe] agents owned by operator: ${myAgents.length}`);
  for (const a of myAgents) {
    console.log(
      `  - did=${Buffer.from(a.did).toString('hex').slice(0, 16)}.. status=${a.status} jobs=${a.jobsCompleted} stake=${a.stakeAmount}`,
    );
  }

  console.log('\n[probe] === task_market.global ===');
  const market = taskMarketProgram(provider, cluster);
  const global = await fetchMarketGlobal(market);
  if (global) {
    console.log(`  authority: ${global.authority.toBase58()}`);
    console.log(`  proofVerifier: ${global.proofVerifier.toBase58()}`);
    console.log(`  paused: ${(global as { paused?: boolean }).paused ?? 'unknown'}`);
  } else {
    console.log('  market_global not found');
  }

  console.log('\n[probe] === proof_verifier active key ===');
  const activeVk = await fetchActiveVerifierKey({ provider, cluster });
  if (activeVk) {
    const label = Buffer.from(activeVk.circuitLabel).toString('utf8').replace(/\0+$/, '');
    console.log(`  active VK PDA: ${activeVk.address.toBase58()}`);
    console.log(`  circuit label: ${label}`);
    console.log(`  vkId hex     : ${Buffer.from(activeVk.vkId).toString('hex')}`);
    console.log(`  isProduction : ${activeVk.isProduction}`);
    console.log(`  numPublicInputs: ${activeVk.numPublicInputs}`);
  } else {
    console.log('  no active verifier key');
  }

  console.log('\n[probe] === proof_verifier program info ===');
  const pv = proofVerifierProgram(provider, cluster);
  console.log(`  program id: ${pv.programId.toBase58()}`);

  console.log('\n[probe] === proof_verifier verifier_config ===');
  const { fetchVerifierConfig } = await import('@saep/sdk');
  const vc = await fetchVerifierConfig(pv);
  if (vc) {
    console.log(`  authority: ${vc.authority.toBase58()}`);
    console.log(`  activeVk: ${vc.activeVk.toBase58()}`);
    console.log(`  pendingVk: ${vc.pendingVk?.toBase58() ?? 'null'}`);
    console.log(`  paused: ${vc.paused}`);
  }
}

main().catch((err) => {
  console.error('[probe] failed:', err);
  process.exit(1);
});
