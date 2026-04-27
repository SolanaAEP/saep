import { z } from 'zod';
import {
  RegisterAgentSchema,
  ListTasksSchema,
  GetReputationSchema,
  BidSchema,
  RevealBidSchema,
  SubmitResultSchema,
  WithdrawEarningsSchema,
  createHandlerContext,
  handleRegisterAgent,
  handleListTasks,
  handleGetReputation,
  handleBid,
  handleRevealBid,
  handleSubmitResult,
  handleWithdrawEarnings,
  resetVelocityWindow,
} from '@saep/handlers';
import type { Action, SaepPluginOptions, SakAgentLike, SakCluster } from './types.js';

function wrapHandler<S extends z.ZodTypeAny>(
  cluster: SakCluster,
  opts: SaepPluginOptions | undefined,
  schema: S,
  meta: Omit<Action, 'schema' | 'handler'>,
  fn: (ctx: ReturnType<typeof createHandlerContext>, input: z.infer<S>) => Promise<Record<string, unknown>>,
): Action {
  return {
    ...meta,
    schema,
    handler: async (agent: SakAgentLike, input: z.infer<S>) => {
      const ctx = createHandlerContext(cluster, agent.connection, agent.wallet);
      return fn(ctx, input);
    },
  };
}

export function saepRegisterAgentAction(cluster: SakCluster, opts?: SaepPluginOptions): Action {
  return wrapHandler(cluster, opts, RegisterAgentSchema, {
    name: 'SAEP_REGISTER_AGENT',
    similes: [
      'register my agent with saep',
      'sign up on saep marketplace',
      'create saep agent account',
    ],
    description:
      'One-time bootstrap: registers the SAK wallet as a SAEP operator and creates an AgentAccount. ' +
      'Args: { capability_bits[], metadata_uri, stake_mint, operator_token_account, agent_id_seed?, ' +
      'stake_amount?, price_lamports?, stream_rate? }. Returns { signature, agent_address, agent_did_hex }.',
    examples: [
      {
        input: 'Register me for code_gen with my USDC stake account',
        output:
          'SAEP_REGISTER_AGENT { capability_bits: [2], metadata_uri: "https://...", ' +
          'stake_mint: "EPjFWdd...", operator_token_account: "9ATA...", stake_amount: "1000000" }',
      },
    ],
  }, (ctx, input) => handleRegisterAgent(ctx, input, opts));
}

export function saepListTasksAction(cluster: SakCluster, _opts?: SaepPluginOptions): Action {
  return wrapHandler(cluster, _opts, ListTasksSchema, {
    name: 'SAEP_LIST_TASKS',
    similes: [
      'find my saep tasks',
      'list tasks assigned to me',
      'what jobs do i have',
      'show my task queue',
    ],
    description:
      'Lists SAEP tasks assigned to this operator. If agent_did_hex omitted, resolves to the first ' +
      'active agent owned by the wallet. Args: { agent_did_hex?, limit? }.',
    examples: [
      { input: 'Show me my open tasks', output: 'SAEP_LIST_TASKS {}' },
      { input: 'List tasks for agent DID 4af3...', output: 'SAEP_LIST_TASKS { agent_did_hex: "4af3..." }' },
    ],
  }, (ctx, input) => handleListTasks(ctx, input));
}

export function saepGetReputationAction(cluster: SakCluster, _opts?: SaepPluginOptions): Action {
  return wrapHandler(cluster, _opts, GetReputationSchema, {
    name: 'SAEP_GET_REPUTATION',
    similes: [
      'show my saep reputation',
      'what is my agent score',
      'check agent trust metrics',
    ],
    description:
      'Reads SAEP reputation for the specified agent DID, or the first active agent owned by the wallet. ' +
      'Args: { agent_did_hex?, capability_bit? }. capability_bit is accepted for forward compatibility; current scores are global.',
    examples: [
      { input: 'Show my current SAEP reputation', output: 'SAEP_GET_REPUTATION {}' },
    ],
  }, (ctx, input) => handleGetReputation(ctx, input));
}

export function saepBidAction(cluster: SakCluster, opts?: SaepPluginOptions): Action {
  return wrapHandler(cluster, opts, BidSchema, {
    name: 'SAEP_BID',
    similes: [
      'bid on saep task',
      'take this job',
      'submit a bid',
      'compete for that task',
    ],
    description:
      'Commit phase of a commit-reveal bid. Stores commit_hash + posts bond. Returns nonce + amount — ' +
      'caller MUST persist these to reveal later via SAEP_REVEAL_BID before the reveal window closes. ' +
      'Args: { task_address, amount_usdc_micro, agent_did_hex, bidder_token_account }.',
    examples: [
      {
        input: 'Bid 50 cents on task 7xK2... using agent 4af3... and USDC account 9ATA...',
        output:
          'SAEP_BID { task_address: "7xK2...", amount_usdc_micro: 500000, ' +
          'agent_did_hex: "4af3...", bidder_token_account: "9ATA..." }',
      },
    ],
  }, (ctx, input) => handleBid(ctx, input, opts));
}

export function saepRevealBidAction(cluster: SakCluster, opts?: SaepPluginOptions): Action {
  return wrapHandler(cluster, opts, RevealBidSchema, {
    name: 'SAEP_REVEAL_BID',
    similes: [
      'reveal my saep bid',
      'open the sealed bid',
      'submit bid reveal',
    ],
    description:
      'Reveal phase: submits the (amount, nonce) committed via SAEP_BID. Must land during the reveal ' +
      'window or the bond is slashed. Args: { task_address, amount_usdc_micro, nonce_hex }.',
    examples: [
      {
        input: 'Reveal my 500000 micro-USDC bid on task 7xK2... with nonce abc1...',
        output:
          'SAEP_REVEAL_BID { task_address: "7xK2...", amount_usdc_micro: 500000, nonce_hex: "abc1..." }',
      },
    ],
  }, (ctx, input) => handleRevealBid(ctx, input, opts));
}

export function saepSubmitResultAction(cluster: SakCluster, opts?: SaepPluginOptions): Action {
  return wrapHandler(cluster, opts, SubmitResultSchema, {
    name: 'SAEP_SUBMIT_RESULT',
    similes: [
      'submit my work for saep task',
      'deliver the result',
      'finalize saep task completion',
    ],
    description:
      'Submit result for an assigned task. Derives the agent account from the task\'s agent_did. ' +
      'Args: { task_address (base58), result_hash (hex32), proof_key (hex32) }.',
    examples: [
      {
        input: 'Submit result for task 7xK2... with hash 4af3... and proof_key 0001...',
        output:
          'SAEP_SUBMIT_RESULT { task_address: "7xK2...", result_hash: "4af3...", proof_key: "0001..." }',
      },
    ],
  }, (ctx, input) => handleSubmitResult(ctx, input, opts));
}

export function saepWithdrawEarningsAction(cluster: SakCluster, opts?: SaepPluginOptions): Action {
  return wrapHandler(cluster, opts, WithdrawEarningsSchema, {
    name: 'SAEP_WITHDRAW_EARNINGS',
    similes: [
      'withdraw my streamed earnings',
      'claim treasury stream payout',
      'pull funds from a saep payment stream',
    ],
    description:
      'Withdraws accrued earnings from a treasury payment stream. Same-mint direct withdrawals work out of the box; ' +
      'swap withdrawals require route_data_base64 plus Jupiter and oracle accounts.',
    examples: [
      {
        input: 'Withdraw earnings from stream 7xK2...',
        output: 'SAEP_WITHDRAW_EARNINGS { stream_address: "7xK2..." }',
      },
    ],
  }, (ctx, input) => handleWithdrawEarnings(ctx, input, opts));
}

export function saepPlugin(cluster: SakCluster = 'devnet', opts?: SaepPluginOptions): Action[] {
  return [
    saepRegisterAgentAction(cluster, opts),
    saepListTasksAction(cluster, opts),
    saepGetReputationAction(cluster, opts),
    saepBidAction(cluster, opts),
    saepRevealBidAction(cluster, opts),
    saepSubmitResultAction(cluster, opts),
    saepWithdrawEarningsAction(cluster, opts),
  ];
}

export { resetVelocityWindow as _resetVelocityWindow } from '@saep/handlers';
