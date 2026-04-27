import type { ZodTypeAny } from 'zod';
import {
  RegisterAgentSchema,
  ListTasksSchema,
  DiscoverTasksSchema,
  GetTaskSchema,
  GetReputationSchema,
  BidSchema,
  RevealBidSchema,
  SubmitResultSchema,
  ClaimPayoutSchema,
  WithdrawEarningsSchema,
  handleRegisterAgent,
  handleListTasks,
  handleDiscoverTasks,
  handleGetTask,
  handleGetReputation,
  handleBid,
  handleRevealBid,
  handleSubmitResult,
  handleClaimPayout,
  handleWithdrawEarnings,
  type GuardrailOpts,
  type HandlerContext,
  type DiscoveryBackend,
} from '@saep/handlers';
import type { SynapseToolDefinition } from './synapse-types.js';
import type { SynapsePluginOptions, NonceStore } from './types.js';
import { zodToJsonSchema } from './schema-util.js';

export interface ToolContext {
  ctx: HandlerContext;
  guardrails: GuardrailOpts;
  nonceStore?: NonceStore;
  discovery?: DiscoveryBackend;
}

function tool(
  name: string,
  description: string,
  schema: ZodTypeAny,
  handler: (params: Record<string, unknown>, tc: ToolContext) => Promise<unknown>,
  tc: ToolContext,
): SynapseToolDefinition {
  return {
    name,
    description,
    parameters: zodToJsonSchema(schema),
    handler: (params) => handler(params, tc),
  };
}

export function buildSynapseTools(
  opts: SynapsePluginOptions,
  ctx: HandlerContext,
  nonceStore?: NonceStore,
  discovery?: DiscoveryBackend,
): SynapseToolDefinition[] {
  const guardrails: GuardrailOpts = {
    maxAutoSignLamports: opts.maxAutoSignLamports,
    velocityLimit: opts.velocityLimit,
  };
  const tc: ToolContext = { ctx, guardrails, nonceStore, discovery };

  return [
    tool(
      'saep_register_agent',
      'Register a new SAEP agent for this operator. One-time bootstrap that creates an AgentAccount on-chain.',
      RegisterAgentSchema,
      async (params, { ctx, guardrails }) => {
        const input = RegisterAgentSchema.parse(params);
        return handleRegisterAgent(ctx, input, guardrails);
      },
      tc,
    ),

    tool(
      'saep_discover_tasks',
      'Browse marketplace tasks by capability, status, and minimum payment. Uses discovery service when available.',
      DiscoverTasksSchema,
      async (params, { ctx, discovery }) => {
        const input = DiscoverTasksSchema.parse(params);
        return handleDiscoverTasks(ctx, input, discovery);
      },
      tc,
    ),

    tool(
      'saep_get_task',
      'Fetch full detail for a single task by its on-chain address.',
      GetTaskSchema,
      async (params, { ctx }) => {
        const input = GetTaskSchema.parse(params);
        return handleGetTask(ctx, input);
      },
      tc,
    ),

    tool(
      'saep_my_tasks',
      'List tasks assigned to this operator, optionally filtered by agent DID.',
      ListTasksSchema,
      async (params, { ctx }) => {
        const input = ListTasksSchema.parse(params);
        return handleListTasks(ctx, input);
      },
      tc,
    ),

    tool(
      'saep_get_reputation',
      'Read reputation dimensions for an agent. Returns quality, timeliness, availability, cost efficiency, honesty, and volume scores.',
      GetReputationSchema,
      async (params, { ctx }) => {
        const input = GetReputationSchema.parse(params);
        return handleGetReputation(ctx, input);
      },
      tc,
    ),

    tool(
      'saep_bid',
      'Submit a sealed bid (commit phase). Generates nonce, posts bond. Nonce is auto-persisted to the nonce store for later reveal.',
      BidSchema,
      async (params, { ctx, guardrails, nonceStore }) => {
        const input = BidSchema.parse(params);
        const result = await handleBid(ctx, input, guardrails);
        if (nonceStore && result.nonce_hex && !result.error) {
          try {
            await nonceStore.save({
              taskAddress: input.task_address,
              taskIdHex: result.task_id_hex as string,
              agentDidHex: input.agent_did_hex,
              amountUsdcMicro: input.amount_usdc_micro,
              nonceHex: result.nonce_hex as string,
              createdAt: Date.now(),
            });
          } catch {
            result.warning =
              (result.warning ?? '') + ' NONCE PERSISTENCE FAILED — save nonce_hex manually or reveal will fail.';
          }
        }
        return result;
      },
      tc,
    ),

    tool(
      'saep_reveal_bid',
      'Reveal a previously committed bid. If nonce_hex is omitted, looks up the nonce store by task address.',
      RevealBidSchema.extend({
        nonce_hex: RevealBidSchema.shape.nonce_hex.optional(),
      }),
      async (params, { ctx, guardrails, nonceStore }) => {
        let nonceHex = (params as { nonce_hex?: string }).nonce_hex;
        const taskAddress = (params as { task_address: string }).task_address;
        let amountOverride: number | undefined;

        if (!nonceHex && nonceStore) {
          const entry = await nonceStore.get(taskAddress);
          if (entry) {
            nonceHex = entry.nonceHex;
            amountOverride = entry.amountUsdcMicro;
          }
        }
        if (!nonceHex) {
          return { error: 'nonce_not_found', task_address: taskAddress };
        }

        const merged = amountOverride !== undefined
          ? { ...params, nonce_hex: nonceHex, amount_usdc_micro: amountOverride }
          : { ...params, nonce_hex: nonceHex };
        const input = RevealBidSchema.parse(merged);
        const result = await handleRevealBid(ctx, input, guardrails);

        if (!result.error && nonceStore) {
          await nonceStore.delete(taskAddress);
        }
        return result;
      },
      tc,
    ),

    tool(
      'saep_submit_result',
      'Submit result hash and proof key for a completed task.',
      SubmitResultSchema,
      async (params, { ctx, guardrails }) => {
        const input = SubmitResultSchema.parse(params);
        return handleSubmitResult(ctx, input, guardrails);
      },
      tc,
    ),

    tool(
      'saep_claim_payout',
      'Release escrow for a verified task. Derives agent and token accounts automatically.',
      ClaimPayoutSchema,
      async (params, { ctx, guardrails }) => {
        const input = ClaimPayoutSchema.parse(params);
        return handleClaimPayout(ctx, input, guardrails);
      },
      tc,
    ),

    tool(
      'saep_withdraw_earnings',
      'Withdraw accrued earnings from a treasury payment stream. Same-mint withdrawals work directly; cross-mint requires Jupiter swap route.',
      WithdrawEarningsSchema,
      async (params, { ctx, guardrails }) => {
        const input = WithdrawEarningsSchema.parse(params);
        return handleWithdrawEarnings(ctx, input, guardrails);
      },
      tc,
    ),
  ];
}
