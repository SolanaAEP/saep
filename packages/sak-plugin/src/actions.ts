import { z } from 'zod';
import type { Action, SakCluster } from './types.js';

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

const NOT_WIRED = {
  error: 'NOT_YET_WIRED',
  reason:
    '@saep/sak-plugin scaffold; handlers stub pending SDK program factories for task_market/agent_registry. Tracked in backlog/P1_protocol_integrations_x402_mcp_sak.md.',
};

export function saepRegisterAgentAction(cluster: SakCluster): Action {
  const schema = z.object({
    capability_bits: z.array(z.number().int().min(0).max(127)).min(1),
    metadata_uri: z.string().url(),
  });
  return {
    name: 'SAEP_REGISTER_AGENT',
    similes: [
      'register my agent with saep',
      'sign up on saep marketplace',
      'create saep agent account',
    ],
    description:
      'One-time bootstrap: registers the SAK wallet as a SAEP operator and creates an AgentAccount. Args: { capability_bits[], metadata_uri }.',
    examples: [
      {
        input: 'Register me for code_gen and image_gen capabilities',
        output: 'SAEP_REGISTER_AGENT { capability_bits: [0, 1], metadata_uri: ... }',
      },
    ],
    schema,
    handler: async (_agent, input) => {
      schema.parse(input);
      return { cluster, ...NOT_WIRED };
    },
  };
}

export function saepListTasksAction(cluster: SakCluster): Action {
  const schema = z.object({
    capability_bit: z.number().int().min(0).max(127).optional(),
    max_payment_usdc: z.number().positive().optional(),
    min_payment_usdc: z.number().nonnegative().optional(),
    limit: z.number().int().min(1).max(100).default(20),
  });
  return {
    name: 'SAEP_LIST_TASKS',
    similes: [
      'find open saep tasks',
      'browse saep marketplace',
      'list available tasks',
      'what jobs are open',
    ],
    description:
      'Lists open SAEP tasks filtered by capability + payment bounds. Args: { capability_bit?, min_payment_usdc?, max_payment_usdc?, limit? }.',
    examples: [
      {
        input: 'Find image-gen tasks paying at least $5',
        output: 'SAEP_LIST_TASKS { capability_bit: 1, min_payment_usdc: 5 }',
      },
    ],
    schema,
    handler: async (_agent, input) => {
      schema.parse(input);
      return { cluster, tasks: [], note: NOT_WIRED };
    },
  };
}

export function saepBidAction(cluster: SakCluster): Action {
  const schema = z.object({
    task_id: Base58,
    amount_usdc_micro: z.number().int().positive(),
  });
  return {
    name: 'SAEP_BID',
    similes: [
      'bid on saep task',
      'take this job',
      'submit a bid',
      'compete for that task',
    ],
    description:
      'Commit + auto-reveal bid on a SAEP task. Handler internally waits the reveal window. Args: { task_id, amount_usdc_micro }.',
    examples: [
      {
        input: 'Bid 50 cents on task ABC123',
        output: 'SAEP_BID { task_id: "ABC123...", amount_usdc_micro: 500000 }',
      },
    ],
    schema,
    handler: async (_agent, input) => {
      schema.parse(input);
      return { cluster, ...NOT_WIRED };
    },
  };
}

export function saepSubmitResultAction(cluster: SakCluster): Action {
  const schema = z.object({
    task_id: Base58,
    result_cid: z.string().min(1),
    proof_ref: z.string().min(1),
  });
  return {
    name: 'SAEP_SUBMIT_RESULT',
    similes: [
      'submit my work for saep task',
      'deliver the result',
      'finalize saep task completion',
    ],
    description:
      'Submit result for an awarded task with result CID + proof reference. Args: { task_id, result_cid, proof_ref }.',
    examples: [
      {
        input: 'Submit the generated image for task XYZ',
        output:
          'SAEP_SUBMIT_RESULT { task_id: "XYZ...", result_cid: "ipfs://...", proof_ref: "..." }',
      },
    ],
    schema,
    handler: async (_agent, input) => {
      schema.parse(input);
      return { cluster, ...NOT_WIRED };
    },
  };
}

export function saepPlugin(cluster: SakCluster = 'devnet'): Action[] {
  return [
    saepRegisterAgentAction(cluster),
    saepListTasksAction(cluster),
    saepBidAction(cluster),
    saepSubmitResultAction(cluster),
  ];
}
