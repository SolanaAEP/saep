import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { taskMarketProgram } from '@saep/sdk';
import type { HandlerContext, HandlerResult } from '../types.js';
import type { DiscoverTasksInput } from '../schemas.js';
import { bytesToHex } from '../crypto.js';

const USER_STATUS_MAP: Record<string, string[]> = {
  open: ['created', 'funded'],
  bidding: [],
  awarded: ['inExecution', 'proofSubmitted'],
  settled: ['verified', 'released'],
  disputed: ['disputed'],
};

export interface DiscoveryBackend {
  search(params: {
    capability?: number;
    statuses?: string[];
    minReward?: number;
    limit: number;
  }): Promise<{ task_id_hex: string }[]>;
}

interface RawTaskAccount {
  taskId: number[];
  client: PublicKey;
  agentDid: number[];
  paymentMint: PublicKey;
  paymentAmount: BN;
  status: Record<string, unknown>;
  deadline: BN;
  verified: boolean;
  createdAt: BN;
}

export async function handleDiscoverTasks(
  ctx: HandlerContext,
  input: DiscoverTasksInput,
  discovery?: DiscoveryBackend,
): Promise<HandlerResult> {
  const tm = taskMarketProgram(ctx.provider, ctx.config);
  const allowed = input.status ? USER_STATUS_MAP[input.status] ?? [] : null;
  const minPay =
    input.min_payment_usdc !== undefined ? BigInt(Math.round(input.min_payment_usdc * 1_000_000)) : null;

  if (!discovery && input.capability_bit !== undefined) {
    return {
      cluster: ctx.cluster,
      tasks: [],
      error: 'DISCOVERY_REQUIRED',
      reason: 'capability_bit search routes through the discovery service',
    };
  }

  let discoveryHits: { task_id_hex: string }[] | null = null;
  if (discovery) {
    discoveryHits = await discovery.search({
      capability: input.capability_bit,
      statuses: allowed && allowed.length > 0 ? allowed : undefined,
      minReward: input.min_payment_usdc !== undefined ? Math.round(input.min_payment_usdc * 1_000_000) : undefined,
      limit: input.limit,
    });
    if (discoveryHits.length === 0) {
      return { cluster: ctx.cluster, tasks: [], total_matched: 0 };
    }
  }

  const accounts = await tm.account.taskContract.all();

  let filtered = accounts.map(({ publicKey, account }) => {
    const a = account as unknown as RawTaskAccount;
    const status = Object.keys(a.status)[0] ?? 'unknown';
    return {
      task_address: publicKey.toBase58(),
      task_id_hex: bytesToHex(a.taskId),
      client: a.client.toBase58(),
      agent_did_hex: bytesToHex(a.agentDid),
      payment_mint: a.paymentMint.toBase58(),
      payment_amount: a.paymentAmount.toString(),
      status,
      deadline: a.deadline.toNumber(),
      verified: a.verified,
      created_at: a.createdAt.toNumber(),
    };
  }).filter((task) => {
    if (allowed && !allowed.includes(task.status)) return false;
    if (minPay !== null && BigInt(task.payment_amount) < minPay) return false;
    return true;
  });

  if (discoveryHits) {
    const ranks = new Map(discoveryHits.map((t, i) => [t.task_id_hex, i]));
    filtered = filtered
      .filter((t) => ranks.has(t.task_id_hex))
      .sort((a, b) => (ranks.get(a.task_id_hex) ?? Infinity) - (ranks.get(b.task_id_hex) ?? Infinity));
  }

  return {
    cluster: ctx.cluster,
    tasks: filtered.slice(0, input.limit),
    total_matched: filtered.length,
  };
}
