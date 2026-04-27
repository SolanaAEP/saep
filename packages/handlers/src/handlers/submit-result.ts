import { PublicKey, Transaction } from '@solana/web3.js';
import {
  agentRegistryProgram,
  taskMarketProgram,
  buildSubmitResultIx,
  fetchAgentByDid,
} from '@saep/sdk';
import type { HandlerContext, HandlerResult } from '../types.js';
import type { SubmitResultInput } from '../schemas.js';
import { hexToBytes, bytesToHex } from '../crypto.js';
import { enforceGuardrails, type GuardrailOpts } from '../guardrails.js';

export async function handleSubmitResult(
  ctx: HandlerContext,
  input: SubmitResultInput,
  opts?: GuardrailOpts,
): Promise<HandlerResult> {
  const tm = taskMarketProgram(ctx.provider, ctx.config);
  const ar = agentRegistryProgram(ctx.provider, ctx.config);

  const taskPk = new PublicKey(input.task_address);
  const task = await tm.account.taskContract.fetch(taskPk);
  const didHex = bytesToHex(Uint8Array.from(task.agentDid as number[]));
  const agentAcc = await fetchAgentByDid(ar, didHex);
  if (!agentAcc) {
    return { cluster: ctx.cluster, error: 'agent_not_found_for_task', agent_did_hex: didHex };
  }

  const ix = await buildSubmitResultIx(tm, ctx.config, {
    operator: ctx.operator,
    task: taskPk,
    agentAccount: agentAcc.address,
    resultHash: hexToBytes(input.result_hash),
    proofKey: hexToBytes(input.proof_key),
  });
  const tx = new Transaction().add(ix);
  enforceGuardrails(opts);
  const signature = await ctx.provider.sendAndConfirm(tx);

  return { cluster: ctx.cluster, signature, agent_did_hex: didHex };
}
