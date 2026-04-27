import { PublicKey, Transaction } from '@solana/web3.js';
import { taskMarketProgram, buildRevealBidIx } from '@saep/sdk';
import type { HandlerContext, HandlerResult } from '../types.js';
import type { RevealBidInput } from '../schemas.js';
import { hexToBytes, bytesToHex } from '../crypto.js';
import { enforceGuardrails, type GuardrailOpts } from '../guardrails.js';

export async function handleRevealBid(
  ctx: HandlerContext,
  input: RevealBidInput,
  opts?: GuardrailOpts,
): Promise<HandlerResult> {
  const tm = taskMarketProgram(ctx.provider, ctx.config);

  const taskPk = new PublicKey(input.task_address);
  const task = await tm.account.taskContract.fetch(taskPk);
  const taskId = Uint8Array.from(task.taskId as number[]);

  const ix = await buildRevealBidIx(tm, {
    bidder: ctx.operator,
    task: taskPk,
    taskId,
    amount: BigInt(input.amount_usdc_micro),
    nonce: hexToBytes(input.nonce_hex),
  });
  const tx = new Transaction().add(ix);
  enforceGuardrails(opts);
  const signature = await ctx.provider.sendAndConfirm(tx);

  return { cluster: ctx.cluster, signature, task_id_hex: bytesToHex(taskId) };
}
