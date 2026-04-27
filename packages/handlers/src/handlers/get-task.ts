import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { taskMarketProgram } from '@saep/sdk';
import type { HandlerContext, HandlerResult } from '../types.js';
import type { GetTaskInput } from '../schemas.js';
import { bytesToHex } from '../crypto.js';

export async function handleGetTask(
  ctx: HandlerContext,
  input: GetTaskInput,
): Promise<HandlerResult> {
  const tm = taskMarketProgram(ctx.provider, ctx.config);
  const pk = new PublicKey(input.task_address);
  const raw = (await tm.account.taskContract.fetchNullable(pk)) as Record<string, unknown> | null;
  if (!raw) return { cluster: ctx.cluster, error: 'task_not_found' };

  const status = Object.keys(raw.status as Record<string, unknown>)[0] ?? 'unknown';
  return {
    cluster: ctx.cluster,
    task_address: pk.toBase58(),
    task_id_hex: bytesToHex(raw.taskId as number[]),
    client: (raw.client as PublicKey).toBase58(),
    agent_did_hex: bytesToHex(raw.agentDid as number[]),
    payment_mint: (raw.paymentMint as PublicKey).toBase58(),
    payment_amount: (raw.paymentAmount as BN).toString(),
    status,
    deadline: (raw.deadline as BN).toNumber(),
    verified: raw.verified as boolean,
    created_at: (raw.createdAt as BN).toNumber(),
    task_hash_hex: bytesToHex(raw.taskHash as number[]),
    result_hash_hex: bytesToHex(raw.resultHash as number[]),
    proof_key_hex: bytesToHex(raw.proofKey as number[]),
    criteria_root_hex: bytesToHex(raw.criteriaRoot as number[]),
    protocol_fee: (raw.protocolFee as BN).toString(),
    solrep_fee: (raw.solrepFee as BN).toString(),
    milestone_count: raw.milestoneCount as number,
    milestones_complete: raw.milestonesComplete as number,
  };
}
