import { PublicKey, Transaction } from '@solana/web3.js';
import {
  agentRegistryProgram,
  taskMarketProgram,
  buildCommitBidIx,
  fetchAgentByDid,
} from '@saep/sdk';
import type { HandlerContext, HandlerResult } from '../types.js';
import type { BidInput } from '../schemas.js';
import { hexToBytes, bytesToHex, randomNonce, commitHash } from '../crypto.js';
import { enforceGuardrails, type GuardrailOpts } from '../guardrails.js';

export async function handleBid(
  ctx: HandlerContext,
  input: BidInput,
  opts?: GuardrailOpts,
): Promise<HandlerResult> {
  const tm = taskMarketProgram(ctx.provider, ctx.config);
  const ar = agentRegistryProgram(ctx.provider, ctx.config);

  const taskPk = new PublicKey(input.task_address);
  const task = await tm.account.taskContract.fetch(taskPk);
  const taskId = Uint8Array.from(task.taskId as number[]);
  const paymentMint = task.paymentMint as PublicKey;

  const agentAcc = await fetchAgentByDid(ar, input.agent_did_hex);
  if (!agentAcc) {
    return { cluster: ctx.cluster, error: 'agent_not_found', agent_did_hex: input.agent_did_hex };
  }
  if (!agentAcc.operator.equals(ctx.operator)) {
    return {
      cluster: ctx.cluster,
      error: 'operator_mismatch',
      reason: 'wallet is not the registered operator for this agent_did',
    };
  }

  const agentDid = hexToBytes(input.agent_did_hex);
  const amount = BigInt(input.amount_usdc_micro);
  const nonce = randomNonce();
  const hash = commitHash(amount, nonce, agentDid);

  const ix = await buildCommitBidIx(tm, ctx.config, {
    bidder: ctx.operator,
    task: taskPk,
    taskId,
    paymentMint,
    bidderTokenAccount: new PublicKey(input.bidder_token_account),
    agentOperator: agentAcc.operator,
    agentId: agentAcc.agentId,
    agentDid,
    commitHash: hash,
  });
  const tx = new Transaction().add(ix);
  enforceGuardrails(opts);
  const signature = await ctx.provider.sendAndConfirm(tx);

  return {
    cluster: ctx.cluster,
    signature,
    nonce_hex: bytesToHex(nonce),
    amount_usdc_micro: input.amount_usdc_micro,
    agent_did_hex: input.agent_did_hex,
    task_id_hex: bytesToHex(taskId),
    warning: 'PERSIST nonce_hex — required for reveal_bid. Loss forfeits bond.',
  };
}
