// QVAC tool definitions that expose @saep/sdk fetchers to a tool-calling LLM.
// The agent's reasoning loop can invoke these by emitting a tool_call; the
// runtime executes them and feeds the result back into the conversation.
//
// In the offline demo, the handlers return canned responses so judges can see
// the tool-call flow without an RPC keypair. In the on-chain index loop, the
// runtime hands over a real {market, registry, treasury} program set so the
// LLM literally reads on-chain state inside its grounded answer.

import { z } from 'zod';
import type { SaepCluster } from '@saep/sdk';
import type { AnchorProvider } from '@coral-xyz/anchor';

export const fetchAgentSchema = z.object({
  did: z.string().describe('Agent DID — 32-byte hex or base58 pubkey'),
});
export const fetchTaskSchema = z.object({
  task_id: z.string().describe('Task ID — 32-byte hex'),
});
export const fetchTreasurySchema = z.object({
  agent_did: z.string().describe('Agent DID whose treasury we want'),
});

export const SAEP_TOOL_NAMES = ['fetch_agent', 'fetch_task', 'fetch_treasury'] as const;

export type SaepToolName = (typeof SAEP_TOOL_NAMES)[number];

export type SaepToolDef = {
  name: SaepToolName;
  description: string;
  parameters: z.ZodTypeAny;
};

export const SAEP_TOOLS: readonly SaepToolDef[] = [
  {
    name: 'fetch_agent',
    description:
      'Look up a SAEP agent by DID. Returns operator pubkey, capability mask, status, jobs completed, and stake amount.',
    parameters: fetchAgentSchema,
  },
  {
    name: 'fetch_task',
    description:
      'Look up an on-chain SAEP task by task_id and client. Returns status, payment amount, deadline, and assigned agent.',
    parameters: fetchTaskSchema,
  },
  {
    name: 'fetch_treasury',
    description:
      'Look up the PDA-owned treasury for a SAEP agent by DID. Returns balance, allowed mints, and streaming-payout schedule.',
    parameters: fetchTreasurySchema,
  },
];

export type ToolResult = {
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type ToolHandler = (args: unknown) => Promise<ToolResult>;

// ── Stub handlers (for offline demo) ──────────────────────────────────────────

export function stubHandlers(): Record<SaepToolName, ToolHandler> {
  return {
    fetch_agent: async (raw) => {
      const args = fetchAgentSchema.safeParse(raw);
      if (!args.success) return { ok: false, error: args.error.message };
      return {
        ok: true,
        result: {
          did: args.data.did,
          operator: 'D3vAGENTopERatorWallEt1111111111111111111111',
          status: 'active',
          jobs_completed: 47,
          stake_amount_lamports: 1_500_000_000,
          capability_mask: '0x0000000000000007',
          stub: true,
        },
      };
    },
    fetch_task: async (raw) => {
      const args = fetchTaskSchema.safeParse(raw);
      if (!args.success) return { ok: false, error: args.error.message };
      return {
        ok: true,
        result: {
          task_id: args.data.task_id,
          status: 'funded',
          payment_amount: '500000',
          payment_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          deadline: Math.floor(Date.now() / 1000) + 3600,
          assigned_agent_did: null,
          stub: true,
        },
      };
    },
    fetch_treasury: async (raw) => {
      const args = fetchTreasurySchema.safeParse(raw);
      if (!args.success) return { ok: false, error: args.error.message };
      return {
        ok: true,
        result: {
          agent_did: args.data.agent_did,
          balance_lamports: 250_000_000,
          allowed_mints: ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'],
          streaming_payouts: [],
          stub: true,
        },
      };
    },
  };
}

// ── Live handlers (for on-chain index loop) ──────────────────────────────────

function toDidHex(input: string): string {
  if (/^[0-9a-fA-F]{64}$/.test(input)) return input.toLowerCase();
  return input;
}

// Lazy-import @saep/sdk so the stub-only path (offline demo) never evaluates
// it. The SDK's compiled anchor.js fails under strict Node ESM resolution due
// to a bn.js default-export edge case in the workspace build, so deferring the
// import keeps the tools-demo runnable without requiring an SDK rebuild.
export async function liveHandlers(opts: {
  provider: AnchorProvider;
  cluster: ReturnType<typeof import('@saep/sdk').resolveCluster>;
}): Promise<Record<SaepToolName, ToolHandler>> {
  const sdk = await import('@saep/sdk');
  const market = sdk.taskMarketProgram(opts.provider, opts.cluster);
  const registry = sdk.agentRegistryProgram(opts.provider, opts.cluster);
  const treasury = sdk.treasuryStandardProgram(opts.provider, opts.cluster);
  const { fetchAgentByDid, fetchTaskById, fetchTreasury } = sdk;

  return {
    fetch_agent: async (raw) => {
      const args = fetchAgentSchema.safeParse(raw);
      if (!args.success) return { ok: false, error: args.error.message };
      const agent = await fetchAgentByDid(registry, toDidHex(args.data.did));
      if (!agent) return { ok: false, error: 'agent_not_found' };
      return {
        ok: true,
        result: {
          did: args.data.did,
          operator: agent.operator.toBase58(),
          status: agent.status,
          jobs_completed: Number(agent.jobsCompleted),
          stake_amount_lamports: Number(agent.stakeAmount),
          capability_mask: '0x' + agent.capabilityMask.toString(16).padStart(16, '0'),
        },
      };
    },
    fetch_task: async (raw) => {
      const args = fetchTaskSchema.safeParse(raw);
      if (!args.success) return { ok: false, error: args.error.message };
      const task = await fetchTaskById(market, args.data.task_id);
      if (!task) return { ok: false, error: 'task_not_found' };
      return {
        ok: true,
        result: {
          task_id: args.data.task_id,
          client: task.client.toBase58(),
          status: task.status,
          payment_amount: task.paymentAmount.toString(),
          payment_mint: task.paymentMint.toBase58(),
          deadline: task.deadline,
          verified: task.verified,
        },
      };
    },
    fetch_treasury: async (raw) => {
      const args = fetchTreasurySchema.safeParse(raw);
      if (!args.success) return { ok: false, error: args.error.message };
      const didBytes = Uint8Array.from(
        toDidHex(args.data.agent_did).match(/.{2}/g)?.map((h: string) => parseInt(h, 16)) ?? [],
      );
      const t = await fetchTreasury(treasury, didBytes);
      if (!t) return { ok: false, error: 'treasury_not_found' };
      return {
        ok: true,
        result: {
          agent_did: args.data.agent_did,
          treasury: t.address.toBase58(),
          operator: t.operator.toBase58(),
          daily_spend_limit: t.dailySpendLimit.toString(),
          per_tx_limit: t.perTxLimit.toString(),
          spent_today: t.spentToday.toString(),
          streaming_active: t.streamingActive,
        },
      };
    },
  };
}

export type SaepCluster_ = SaepCluster;
