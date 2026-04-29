// On-chain verifier resolution + verify_task submission. Fetches the active
// VerifierKey from the deployed proof_verifier so the agent can:
//   1. Use the real vkId as `proof_key` in submit_result (instead of a
//      placeholder circuit label).
//   2. Self-crank verify_task after submit_result so task.verified flips
//      true within the same agent loop.

import type { AnchorProvider, Program } from '@coral-xyz/anchor';
import { PublicKey, Transaction } from '@solana/web3.js';
import {
  buildVerifyTaskIx,
  fetchVerifierConfig,
  proofVerifierProgram,
  type ClusterConfig,
  type TaskMarket,
} from '@saep/sdk';

export type ActiveVk = {
  address: PublicKey;
  vkId: Uint8Array;
  circuitLabel: Uint8Array;
  isProduction: boolean;
  numPublicInputs: number;
};

export async function fetchActiveVerifierKey(opts: {
  provider: AnchorProvider;
  cluster: ClusterConfig;
}): Promise<ActiveVk | null> {
  const program = proofVerifierProgram(opts.provider, opts.cluster);
  const cfg = await fetchVerifierConfig(program);
  if (!cfg) return null;
  const raw = await program.account.verifierKey.fetchNullable(cfg.activeVk);
  if (!raw) return null;
  const decoded = raw as {
    vkId: number[];
    circuitLabel: number[];
    isProduction: boolean;
    numPublicInputs: number;
  };
  return {
    address: cfg.activeVk,
    vkId: Uint8Array.from(decoded.vkId),
    circuitLabel: Uint8Array.from(decoded.circuitLabel),
    isProduction: decoded.isProduction,
    numPublicInputs: decoded.numPublicInputs,
  };
}

export async function submitVerifyTask(opts: {
  provider: AnchorProvider;
  cluster: ClusterConfig;
  market: Program<TaskMarket>;
  taskAddress: PublicKey;
  cranker: PublicKey;
  activeVk: ActiveVk;
  proofBytes: { proofA: Uint8Array; proofB: Uint8Array; proofC: Uint8Array };
}): Promise<string> {
  const ix = await buildVerifyTaskIx(opts.market, opts.cluster, {
    cranker: opts.cranker,
    task: opts.taskAddress,
    verifierKey: opts.activeVk.address,
    vkId: opts.activeVk.vkId,
    proofA: opts.proofBytes.proofA,
    proofB: opts.proofBytes.proofB,
    proofC: opts.proofBytes.proofC,
  });
  const tx = new Transaction().add(ix);
  return opts.provider.sendAndConfirm(tx, [], { commitment: 'confirmed' });
}
