import { PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import {
  agentRegistryProgram,
  taskMarketProgram,
  buildReleaseIx,
  fetchAgentByDid,
  fetchMarketGlobal,
} from '@saep/sdk';
import type { HandlerContext, HandlerResult } from '../types.js';
import type { ClaimPayoutInput } from '../schemas.js';
import { bytesToHex } from '../crypto.js';
import { resolveTokenProgram } from '../context.js';
import { enforceGuardrails, type GuardrailOpts } from '../guardrails.js';

export async function handleClaimPayout(
  ctx: HandlerContext,
  input: ClaimPayoutInput,
  opts?: GuardrailOpts,
): Promise<HandlerResult> {
  const tm = taskMarketProgram(ctx.provider, ctx.config);

  const taskPk = new PublicKey(input.task_address);
  const task = (await tm.account.taskContract.fetchNullable(taskPk)) as Record<string, unknown> | null;
  if (!task) return { cluster: ctx.cluster, error: 'task_not_found' };

  const marketGlobal = await fetchMarketGlobal(tm);
  if (!marketGlobal) return { cluster: ctx.cluster, error: 'market_global_not_found' };

  const paymentMint = task.paymentMint as PublicKey;
  const tokenProgramId = await resolveTokenProgram(ctx.connection, paymentMint);

  const agentAccount = await resolveAgentAccount(ctx, task, input.agent_account_address);
  const agentTokenAccount = input.agent_token_account
    ? new PublicKey(input.agent_token_account)
    : getAssociatedTokenAddressSync(paymentMint, agentAccount.operator, true, tokenProgramId);

  const feeCollectorTokenAccount = getAssociatedTokenAddressSync(
    paymentMint,
    marketGlobal.feeCollector,
    true,
    tokenProgramId,
  );
  const solrepPoolTokenAccount = getAssociatedTokenAddressSync(
    paymentMint,
    marketGlobal.solrepPool,
    true,
    tokenProgramId,
  );

  const ix = await buildReleaseIx(tm, ctx.config, {
    cranker: ctx.operator,
    task: taskPk,
    paymentMint,
    agentTokenAccount,
    feeCollectorTokenAccount,
    solrepPoolTokenAccount,
    agentAccount: agentAccount.address,
    client: task.client as PublicKey,
    tokenProgramId,
  });
  const tx = new Transaction().add(ix);
  enforceGuardrails(opts);
  const signature = await ctx.provider.sendAndConfirm(tx);

  return {
    cluster: ctx.cluster,
    signature,
    task_address: taskPk.toBase58(),
    task_id_hex: bytesToHex(task.taskId as number[]),
    payment_mint: paymentMint.toBase58(),
    payment_amount: (task.paymentAmount as BN).toString(),
    agent_account_address: agentAccount.address.toBase58(),
    agent_token_account: agentTokenAccount.toBase58(),
  };
}

async function resolveAgentAccount(
  ctx: HandlerContext,
  task: Record<string, unknown>,
  explicitAddress?: string,
): Promise<{ address: PublicKey; operator: PublicKey }> {
  const ar = agentRegistryProgram(ctx.provider, ctx.config);

  if (explicitAddress) {
    const address = new PublicKey(explicitAddress);
    const raw = (await ar.account.agentAccount.fetchNullable(address)) as { operator: PublicKey } | null;
    if (!raw) throw new Error('agent_account_not_found');
    return { address, operator: raw.operator };
  }

  const assignedAgent = (task.assignedAgent as PublicKey | null | undefined) ?? null;
  if (assignedAgent) {
    const raw = (await ar.account.agentAccount.fetchNullable(assignedAgent)) as { operator: PublicKey } | null;
    if (raw) return { address: assignedAgent, operator: raw.operator };
  }

  const didHex = bytesToHex(task.agentDid as number[]);
  const agent = await fetchAgentByDid(ar, didHex);
  if (!agent) throw new Error(`agent_not_found_for_task:${didHex}`);
  return { address: agent.address, operator: agent.operator };
}
