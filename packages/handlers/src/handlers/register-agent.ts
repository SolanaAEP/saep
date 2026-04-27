import { PublicKey, Transaction } from '@solana/web3.js';
import {
  agentRegistryProgram,
  buildRegisterAgentIx,
  encodeAgentId,
  fetchAgentsByOperator,
} from '@saep/sdk';
import type { HandlerContext, HandlerResult } from '../types.js';
import type { RegisterAgentInput } from '../schemas.js';
import { bytesToHex } from '../crypto.js';
import { capabilityMaskFrom, randomAgentId } from '../crypto.js';
import { enforceGuardrails, type GuardrailOpts } from '../guardrails.js';

export async function handleRegisterAgent(
  ctx: HandlerContext,
  input: RegisterAgentInput,
  opts?: GuardrailOpts,
): Promise<HandlerResult> {
  const program = agentRegistryProgram(ctx.provider, ctx.config);
  const agentId = input.agent_id_seed ? encodeAgentId(input.agent_id_seed) : randomAgentId();

  const ix = await buildRegisterAgentIx(program, {
    operator: ctx.operator,
    agentId,
    manifestUri: input.metadata_uri,
    capabilityMask: capabilityMaskFrom(input.capability_bits),
    priceLamports: BigInt(input.price_lamports),
    streamRate: BigInt(input.stream_rate),
    stakeAmount: BigInt(input.stake_amount),
    stakeMint: new PublicKey(input.stake_mint),
    operatorTokenAccount: new PublicKey(input.operator_token_account),
    capabilityRegistryProgramId: ctx.config.programIds.capabilityRegistry,
  });

  const tx = new Transaction().add(ix);
  enforceGuardrails(opts);
  const signature = await ctx.provider.sendAndConfirm(tx);

  const fetched = await fetchAgentsByOperator(program, ctx.operator);
  const created = fetched.find((a) => Buffer.from(a.agentId).equals(Buffer.from(agentId)));

  return {
    cluster: ctx.cluster,
    signature,
    agent_address: created?.address.toBase58() ?? null,
    agent_did_hex: created ? bytesToHex(created.did) : null,
    agent_id_hex: bytesToHex(agentId),
  };
}
