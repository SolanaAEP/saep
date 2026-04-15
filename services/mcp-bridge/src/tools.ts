import { z } from 'zod';
import type { Config } from './config.js';

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

export const ListTasksArgs = z.object({
  capability_bit: z.number().int().min(0).max(127).optional(),
  status: z.enum(['open', 'bidding', 'awarded', 'settled', 'disputed']).optional(),
  min_payment_usdc: z.number().nonnegative().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const GetTaskArgs = z.object({ task_id: Base58 });

export const GetReputationArgs = z.object({
  agent_did: Base58,
  capability_bit: z.number().int().min(0).max(127).optional(),
});

export const BidOnTaskArgs = z.object({
  task_id: Base58,
  amount_usdc_micro: z.number().int().positive(),
  nonce: z.string().optional(),
});

export const SubmitResultArgs = z.object({
  task_id: Base58,
  result_cid: z.string().min(1),
  proof_ref: z.string().min(1),
});

export type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: unknown, cfg: Config) => Promise<unknown>;
};

const NOT_WIRED = {
  error: 'NOT_YET_WIRED',
  reason:
    'mcp-bridge scaffold; tool handlers pending SDK program factories for task_market/agent_registry. Tracked in backlog/P1_protocol_integrations_x402_mcp_sak.md.',
};

export function buildTools(): Tool[] {
  return [
    {
      name: 'list_tasks',
      description:
        'List open task_market tasks filtered by capability bit, status, and minimum payment.',
      inputSchema: toJsonSchema(ListTasksArgs),
      handler: async (args) => {
        ListTasksArgs.parse(args);
        return { tasks: [], note: NOT_WIRED };
      },
    },
    {
      name: 'get_task',
      description: 'Fetch a single TaskContract + payload preview by task_id.',
      inputSchema: toJsonSchema(GetTaskArgs),
      handler: async (args) => {
        GetTaskArgs.parse(args);
        return NOT_WIRED;
      },
    },
    {
      name: 'get_reputation',
      description:
        'Read category-scoped ReputationScore for an agent, optionally filtered to one capability bit.',
      inputSchema: toJsonSchema(GetReputationArgs),
      handler: async (args) => {
        GetReputationArgs.parse(args);
        return { scores: [], note: NOT_WIRED };
      },
    },
    {
      name: 'bid_on_task',
      description:
        'Build a commit-reveal bid for a task. Returns unsigned tx by default; auto-signs if SAEP_AUTO_SIGN=true.',
      inputSchema: toJsonSchema(BidOnTaskArgs),
      handler: async (args) => {
        BidOnTaskArgs.parse(args);
        return NOT_WIRED;
      },
    },
    {
      name: 'submit_result',
      description:
        'Build a submit_result instruction for an awarded task; attaches proof_ref from proof-gen service.',
      inputSchema: toJsonSchema(SubmitResultArgs),
      handler: async (args) => {
        SubmitResultArgs.parse(args);
        return NOT_WIRED;
      },
    },
  ];
}

function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as z.ZodObject<z.ZodRawShape>)._def;
  const shape =
    def && 'shape' in def && typeof def.shape === 'function' ? def.shape() : {};
  const properties: Record<string, { type: string; description?: string }> = {};
  const required: string[] = [];
  for (const [key, val] of Object.entries(shape as Record<string, z.ZodTypeAny>)) {
    properties[key] = { type: inferType(val) };
    if (!val.isOptional()) required.push(key);
  }
  return { type: 'object', properties, required };
}

function inferType(val: z.ZodTypeAny): string {
  const typeName = (val._def as { typeName?: string }).typeName ?? '';
  if (typeName.includes('Number')) return 'number';
  if (typeName.includes('Boolean')) return 'boolean';
  if (typeName.includes('Array')) return 'array';
  if (typeName.includes('Object')) return 'object';
  return 'string';
}
