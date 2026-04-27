import {
  agentRegistryProgram,
  fetchAgentsByOperator,
  fetchAgentByDid,
} from '@saep/sdk';
import type { HandlerContext, HandlerResult } from '../types.js';
import type { GetReputationInput } from '../schemas.js';
import { bytesToHex } from '../crypto.js';

export async function handleGetReputation(
  ctx: HandlerContext,
  input: GetReputationInput,
): Promise<HandlerResult> {
  const ar = agentRegistryProgram(ctx.provider, ctx.config);

  let did = input.agent_did_hex;
  if (!did) {
    const mine = await fetchAgentsByOperator(ar, ctx.operator);
    const active = mine.find((item) => item.status === 'active') ?? mine[0];
    if (!active) {
      return { cluster: ctx.cluster, error: 'no_agent_for_operator' };
    }
    did = bytesToHex(active.did);
  }

  const detail = await fetchAgentByDid(ar, did);
  if (!detail) {
    return { cluster: ctx.cluster, error: 'agent_not_found', agent_did_hex: did };
  }

  return {
    cluster: ctx.cluster,
    agent_did_hex: did,
    agent_address: detail.address.toBase58(),
    operator: detail.operator.toBase58(),
    jobs_completed: detail.jobsCompleted.toString(),
    jobs_disputed: detail.jobsDisputed,
    reputation: detail.reputation,
    capability_bit_filter: input.capability_bit ?? null,
    category_scoped: false,
  };
}
