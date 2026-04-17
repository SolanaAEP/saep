import { z } from 'zod';
import { PublicKey, Transaction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { keccak_256 } from '@noble/hashes/sha3.js';
import {
  agentRegistryProgram,
  buildCommitBidIx,
  buildRevealBidIx,
  buildSubmitResultIx,
  fetchAgentByDid,
  resolveCluster,
  taskMarketProgram,
} from '@saep/sdk';
import type { Config } from './config.js';

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Hex32 = z.string().regex(/^[0-9a-f]{64}$/i);

export const ListTasksArgs = z.object({
  capability_bit: z.number().int().min(0).max(127).optional(),
  status: z.enum(['open', 'bidding', 'awarded', 'settled', 'disputed']).optional(),
  min_payment_usdc: z.number().nonnegative().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const GetTaskArgs = z.object({ task_address: Base58 });

export const GetReputationArgs = z.object({
  agent_did_hex: Hex32,
  capability_bit: z.number().int().min(0).max(127).optional(),
});

export const BidOnTaskArgs = z.object({
  task_address: Base58,
  amount_usdc_micro: z.number().int().positive(),
  agent_did_hex: Hex32,
  bidder_token_account: Base58,
});

const RevealBidArgs = z.object({
  task_address: Base58,
  amount_usdc_micro: z.number().int().positive(),
  nonce_hex: Hex32,
});

export const SubmitResultArgs = z.object({
  task_address: Base58,
  result_hash: Hex32,
  proof_key: Hex32,
});

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: unknown, cfg: Config) => Promise<unknown>;
};

const USER_STATUS_MAP: Record<string, string[]> = {
  open: ['created', 'funded'],
  bidding: [],
  awarded: ['inExecution', 'proofSubmitted'],
  settled: ['verified', 'released'],
  disputed: ['disputed'],
};

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}

function bytesToHex(bytes: Uint8Array | number[]): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function amountLe(amount: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let n = amount;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

function computeCommitHash(amount: bigint, nonce: Uint8Array, agentDid: Uint8Array): Uint8Array {
  const buf = new Uint8Array(8 + 32 + 32);
  buf.set(amountLe(amount), 0);
  buf.set(nonce, 8);
  buf.set(agentDid, 40);
  return keccak_256(buf);
}

const autoSignTimestamps: number[] = [];

function checkVelocity(limit: number): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  while (autoSignTimestamps.length > 0 && autoSignTimestamps[0]! < windowStart) {
    autoSignTimestamps.shift();
  }
  return autoSignTimestamps.length < limit;
}

function recordAutoSign(): void {
  autoSignTimestamps.push(Date.now());
}

export function _resetVelocityWindow(): void {
  autoSignTimestamps.length = 0;
}

function serializeUnsigned(
  tx: Transaction,
  operator: PublicKey,
  bh: { blockhash: string; lastValidBlockHeight: number },
): { signed: false; unsigned_tx_base64: string; last_valid_block_height: number } {
  tx.feePayer = operator;
  tx.recentBlockhash = bh.blockhash;
  const serialized = tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString('base64');
  return {
    signed: false,
    unsigned_tx_base64: serialized,
    last_valid_block_height: bh.lastValidBlockHeight,
  };
}

async function signOrSerialize(
  cfg: Config,
  ix: import('@solana/web3.js').TransactionInstruction,
  operator: PublicKey,
  valueLamports?: number,
): Promise<
  | { signed: true; signature: string }
  | { signed: false; unsigned_tx_base64: string; last_valid_block_height: number; auto_sign_rejected?: string }
> {
  const tx = new Transaction().add(ix);
  if (cfg.autoSign && cfg.keypair) {
    if (valueLamports !== undefined && valueLamports > cfg.autoSignMaxLamports) {
      const bh = await cfg.connection.getLatestBlockhash('confirmed');
      return {
        ...serializeUnsigned(tx, operator, bh),
        auto_sign_rejected: `value ${valueLamports} lamports exceeds cap ${cfg.autoSignMaxLamports}`,
      };
    }
    if (!checkVelocity(cfg.autoSignVelocityLimit)) {
      const bh = await cfg.connection.getLatestBlockhash('confirmed');
      return {
        ...serializeUnsigned(tx, operator, bh),
        auto_sign_rejected: `velocity limit exceeded (${cfg.autoSignVelocityLimit} per 60s)`,
      };
    }
    recordAutoSign();
    const signature = await cfg.provider.sendAndConfirm(tx, [cfg.keypair]);
    return { signed: true, signature };
  }
  const bh = await cfg.connection.getLatestBlockhash('confirmed');
  return serializeUnsigned(tx, operator, bh);
}

export function buildTools(): Tool[] {
  return [
    {
      name: 'list_tasks',
      description:
        'Scan task_market for tasks matching status/min_payment filters. Returns up to `limit` rows. ' +
        'Note: `bidding` state is empty until commit-reveal bidding ships. `capability_bit` filter requires joining agent_registry — rejected for M1.',
      inputSchema: toJsonSchema(ListTasksArgs),
      handler: async (args, cfg) => {
        const input = ListTasksArgs.parse(args);
        if (input.capability_bit !== undefined) {
          return {
            tasks: [],
            error: 'CAPABILITY_FILTER_NOT_SUPPORTED',
            reason: 'capability_bit requires per-agent join; deferred to M2 indexer.',
          };
        }
        const config = resolveCluster({ cluster: cfg.cluster });
        const tm = taskMarketProgram(cfg.provider, config);
        const allowed = input.status ? USER_STATUS_MAP[input.status] : null;
        const minPay = input.min_payment_usdc !== undefined
          ? BigInt(Math.round(input.min_payment_usdc * 1_000_000))
          : null;

        const accounts = await tm.account.taskContract.all();
        const mapped = accounts.map(({ publicKey, account }) => {
          const raw = account as unknown as Record<string, unknown>;
          const status = Object.keys(raw.status as Record<string, unknown>)[0] ?? 'unknown';
          return {
            task_address: publicKey.toBase58(),
            task_id_hex: bytesToHex(raw.taskId as number[]),
            client: (raw.client as PublicKey).toBase58(),
            agent_did_hex: bytesToHex(raw.agentDid as number[]),
            payment_mint: (raw.paymentMint as PublicKey).toBase58(),
            payment_amount: (raw.paymentAmount as BN).toString(),
            status,
            deadline: (raw.deadline as BN).toNumber(),
            verified: raw.verified as boolean,
            created_at: (raw.createdAt as BN).toNumber(),
          };
        });
        const filtered = mapped.filter((t) => {
          if (allowed && !allowed.includes(t.status)) return false;
          if (minPay !== null && BigInt(t.payment_amount) < minPay) return false;
          return true;
        });
        return {
          cluster: cfg.cluster,
          tasks: filtered.slice(0, input.limit),
          total_matched: filtered.length,
        };
      },
    },
    {
      name: 'get_task',
      description:
        'Fetch a single TaskContract by account address. Returns full detail: payment, milestones, fees, proof hashes.',
      inputSchema: toJsonSchema(GetTaskArgs),
      handler: async (args, cfg) => {
        const input = GetTaskArgs.parse(args);
        const config = resolveCluster({ cluster: cfg.cluster });
        const tm = taskMarketProgram(cfg.provider, config);
        const pk = new PublicKey(input.task_address);
        const raw = (await tm.account.taskContract.fetchNullable(pk)) as
          | Record<string, unknown>
          | null;
        if (!raw) return { cluster: cfg.cluster, error: 'task_not_found' };
        const status = Object.keys(raw.status as Record<string, unknown>)[0] ?? 'unknown';
        return {
          cluster: cfg.cluster,
          task_address: pk.toBase58(),
          task_id_hex: bytesToHex(raw.taskId as number[]),
          client: (raw.client as PublicKey).toBase58(),
          agent_did_hex: bytesToHex(raw.agentDid as number[]),
          payment_mint: (raw.paymentMint as PublicKey).toBase58(),
          payment_amount: (raw.paymentAmount as BN).toString(),
          status,
          deadline: (raw.deadline as BN).toNumber(),
          verified: raw.verified as boolean,
          created_at: (raw.createdAt as BN).toNumber(),
          task_hash_hex: bytesToHex(raw.taskHash as number[]),
          result_hash_hex: bytesToHex(raw.resultHash as number[]),
          proof_key_hex: bytesToHex(raw.proofKey as number[]),
          criteria_root_hex: bytesToHex(raw.criteriaRoot as number[]),
          protocol_fee: (raw.protocolFee as BN).toString(),
          solrep_fee: (raw.solrepFee as BN).toString(),
          milestone_count: raw.milestoneCount as number,
          milestones_complete: raw.milestonesComplete as number,
        };
      },
    },
    {
      name: 'get_reputation',
      description:
        'Read an agent\'s reputation dims (quality/timeliness/availability/cost_efficiency/honesty/volume). ' +
        'Category-scoped scores per capability_bit ship with pre-audit-03 reputation graph — currently returns global dims only.',
      inputSchema: toJsonSchema(GetReputationArgs),
      handler: async (args, cfg) => {
        const input = GetReputationArgs.parse(args);
        const config = resolveCluster({ cluster: cfg.cluster });
        const ar = agentRegistryProgram(cfg.provider, config);
        const detail = await fetchAgentByDid(ar, input.agent_did_hex);
        if (!detail) return { cluster: cfg.cluster, error: 'agent_not_found' };
        return {
          cluster: cfg.cluster,
          agent_did_hex: input.agent_did_hex,
          agent_address: detail.address.toBase58(),
          operator: detail.operator.toBase58(),
          jobs_completed: detail.jobsCompleted.toString(),
          jobs_disputed: detail.jobsDisputed,
          reputation: detail.reputation,
          capability_bit_filter: input.capability_bit ?? null,
          category_scoped: false,
          note:
            input.capability_bit !== undefined
              ? 'category-scoped scores require pre-audit-03 reputation graph; returning global dims'
              : undefined,
        };
      },
    },
    {
      name: 'bid_on_task',
      description:
        'Commit phase of a commit-reveal bid. Generates a random 32-byte nonce, builds the commit_hash, ' +
        'and calls commit_bid (posts bond to bond_escrow). Returns nonce_hex — caller MUST persist it and ' +
        'call reveal_bid before the reveal window closes, or the bond is slashable. ' +
        'Auto-signs when SAEP_AUTO_SIGN=true, else returns base64 unsigned tx.',
      inputSchema: toJsonSchema(BidOnTaskArgs),
      handler: async (args, cfg) => {
        const input = BidOnTaskArgs.parse(args);
        const config = resolveCluster({ cluster: cfg.cluster });
        const tm = taskMarketProgram(cfg.provider, config);
        const ar = agentRegistryProgram(cfg.provider, config);

        const taskPk = new PublicKey(input.task_address);
        const task = (await tm.account.taskContract.fetchNullable(taskPk)) as
          | { taskId: number[]; paymentMint: PublicKey }
          | null;
        if (!task) return { cluster: cfg.cluster, error: 'task_not_found' };

        const agentAcc = await fetchAgentByDid(ar, input.agent_did_hex);
        if (!agentAcc) {
          return { cluster: cfg.cluster, error: 'agent_not_found', agent_did_hex: input.agent_did_hex };
        }

        const bidder = cfg.keypair?.publicKey ?? cfg.provider.wallet.publicKey;
        if (!agentAcc.operator.equals(bidder)) {
          return {
            cluster: cfg.cluster,
            error: 'operator_mismatch',
            reason: 'bridge keypair is not the registered operator for this agent_did',
            expected_operator: agentAcc.operator.toBase58(),
          };
        }

        const agentDid = hexToBytes(input.agent_did_hex);
        const amount = BigInt(input.amount_usdc_micro);
        const nonce = new Uint8Array(32);
        crypto.getRandomValues(nonce);
        const commitHash = computeCommitHash(amount, nonce, agentDid);
        const taskId = Uint8Array.from(task.taskId);

        const ix = await buildCommitBidIx(tm, {
          bidder,
          task: taskPk,
          taskId,
          paymentMint: task.paymentMint,
          bidderTokenAccount: new PublicKey(input.bidder_token_account),
          agentOperator: agentAcc.operator,
          agentId: agentAcc.agentId,
          agentDid,
          commitHash,
        });
        const outcome = await signOrSerialize(cfg, ix, bidder);
        return {
          cluster: cfg.cluster,
          ...outcome,
          nonce_hex: bytesToHex(nonce),
          amount_usdc_micro: input.amount_usdc_micro,
          agent_did_hex: input.agent_did_hex,
          task_id_hex: bytesToHex(taskId),
          warning: 'PERSIST nonce_hex — required for reveal_bid. Loss forfeits bond.',
        };
      },
    },
    {
      name: 'reveal_bid',
      description:
        'Reveal phase: submits the (amount, nonce) committed via bid_on_task. Must land during the reveal ' +
        'window or the bond is slashed at claim_bond time.',
      inputSchema: toJsonSchema(RevealBidArgs),
      handler: async (args, cfg) => {
        const input = RevealBidArgs.parse(args);
        const config = resolveCluster({ cluster: cfg.cluster });
        const tm = taskMarketProgram(cfg.provider, config);

        const taskPk = new PublicKey(input.task_address);
        const task = (await tm.account.taskContract.fetchNullable(taskPk)) as
          | { taskId: number[] }
          | null;
        if (!task) return { cluster: cfg.cluster, error: 'task_not_found' };

        const bidder = cfg.keypair?.publicKey ?? cfg.provider.wallet.publicKey;
        const taskId = Uint8Array.from(task.taskId);
        const ix = await buildRevealBidIx(tm, {
          bidder,
          task: taskPk,
          taskId,
          amount: BigInt(input.amount_usdc_micro),
          nonce: hexToBytes(input.nonce_hex),
        });
        const outcome = await signOrSerialize(cfg, ix, bidder);
        return { cluster: cfg.cluster, ...outcome, task_id_hex: bytesToHex(taskId) };
      },
    },
    {
      name: 'submit_result',
      description:
        'Submit result_hash + proof_key for an assigned task. If SAEP_AUTO_SIGN=true and SAEP_OPERATOR_KEYPAIR is set, signs + sends; ' +
        'otherwise returns base64-serialized unsigned tx for the caller to co-sign.',
      inputSchema: toJsonSchema(SubmitResultArgs),
      handler: async (args, cfg) => {
        const input = SubmitResultArgs.parse(args);
        const config = resolveCluster({ cluster: cfg.cluster });
        const tm = taskMarketProgram(cfg.provider, config);
        const ar = agentRegistryProgram(cfg.provider, config);

        const taskPk = new PublicKey(input.task_address);
        const raw = (await tm.account.taskContract.fetchNullable(taskPk)) as
          | { agentDid: number[] }
          | null;
        if (!raw) return { cluster: cfg.cluster, error: 'task_not_found' };
        const didHex = bytesToHex(raw.agentDid);

        const agentAcc = await fetchAgentByDid(ar, didHex);
        if (!agentAcc) {
          return { cluster: cfg.cluster, error: 'agent_not_found_for_task', agent_did_hex: didHex };
        }

        const operator = cfg.keypair?.publicKey ?? cfg.provider.wallet.publicKey;
        const ix = await buildSubmitResultIx(tm, {
          operator,
          task: taskPk,
          agentAccount: agentAcc.address,
          resultHash: hexToBytes(input.result_hash),
          proofKey: hexToBytes(input.proof_key),
        });

        const outcome = await signOrSerialize(cfg, ix, operator);
        return { cluster: cfg.cluster, ...outcome, agent_did_hex: didHex };
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
