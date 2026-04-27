import {
  agentRegistryProgram,
  taskMarketProgram,
  fetchAgentsByOperator,
  fetchTasksByAgent,
} from '@saep/sdk';
import type { HandlerContext, HandlerResult } from '../types.js';
import type { ListTasksInput } from '../schemas.js';
import { bytesToHex } from '../crypto.js';

export async function handleListTasks(
  ctx: HandlerContext,
  input: ListTasksInput,
): Promise<HandlerResult> {
  const tm = taskMarketProgram(ctx.provider, ctx.config);

  let did = input.agent_did_hex;
  if (!did) {
    const ar = agentRegistryProgram(ctx.provider, ctx.config);
    const mine = await fetchAgentsByOperator(ar, ctx.operator);
    const active = mine.find((a) => a.status === 'active') ?? mine[0];
    if (!active) {
      return { cluster: ctx.cluster, tasks: [], error: 'no_agent_for_operator' };
    }
    did = bytesToHex(active.did);
  }

  const tasks = await fetchTasksByAgent(tm, did);
  const out = tasks.slice(0, input.limit).map((t) => ({
    task_address: t.address.toBase58(),
    task_id_hex: bytesToHex(t.taskId),
    client: t.client.toBase58(),
    payment_mint: t.paymentMint.toBase58(),
    payment_amount: t.paymentAmount.toString(),
    status: t.status,
    verified: t.verified,
    deadline: t.deadline,
    created_at: t.createdAt,
  }));

  return { cluster: ctx.cluster, agent_did_hex: did, tasks: out };
}
