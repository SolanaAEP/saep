import { z } from 'zod';
import { PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import { keccak_256 } from '@noble/hashes/sha3.js';
import {
  agentRegistryProgram,
  buildRegisterAgentIx,
  buildCommitBidIx,
  buildReleaseIx,
  buildRevealBidIx,
  buildSubmitResultIx,
  buildWithdrawEarnedIx,
  encodeAgentId,
  fetchAgentByDid,
  fetchAgentsByOperator,
  fetchMarketGlobal,
  resolveCluster,
  taskMarketProgram,
  treasuryStandardProgram,
} from '@saep/sdk';
import type { Config } from './config.js';

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Hex32 = z.string().regex(/^[0-9a-f]{64}$/i);
const UintString = z.string().regex(/^\d+$/);

export const RegisterAgentArgs = z.object({
  capability_bits: z.array(z.number().int().min(0).max(127)).min(1),
  metadata_uri: z.string().url(),
  agent_id_seed: z.string().max(32).optional(),
  stake_amount: UintString.default('0'),
  stake_mint: Base58,
  operator_token_account: Base58,
  price_lamports: UintString.default('0'),
  stream_rate: UintString.default('0'),
});

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

export const ClaimPayoutArgs = z.object({
  task_address: Base58,
  agent_account_address: Base58.optional(),
  agent_token_account: Base58.optional(),
});

export const WithdrawEarningsArgs = z.object({
  stream_address: Base58,
  route_data_base64: z.string().optional(),
  jupiter_program: Base58.optional(),
  payer_price_feed: Base58.optional(),
  payout_price_feed: Base58.optional(),
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

function capabilityMaskFrom(bits: number[]): bigint {
  return bits.reduce((mask, bit) => mask | (1n << BigInt(bit)), 0n);
}

function randomAgentId(): Uint8Array {
  const out = new Uint8Array(32);
  crypto.getRandomValues(out);
  return out;
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

type ListedTask = {
  task_address: string;
  task_id_hex: string;
  client: string;
  agent_did_hex: string;
  payment_mint: string;
  payment_amount: string;
  status: string;
  deadline: number;
  verified: boolean;
  created_at: number;
};

type DiscoveryTaskResult = {
  task_id_hex: string;
  status: string | null;
  reward_lamports: string | null;
  capability_mask: string | null;
  created_at_unix: number;
  deadline_unix: number | null;
};

function mapTaskAccount(
  publicKey: PublicKey,
  account: Record<string, unknown>,
): ListedTask {
  const status = Object.keys(account.status as Record<string, unknown>)[0] ?? 'unknown';
  return {
    task_address: publicKey.toBase58(),
    task_id_hex: bytesToHex(account.taskId as number[]),
    client: (account.client as PublicKey).toBase58(),
    agent_did_hex: bytesToHex(account.agentDid as number[]),
    payment_mint: (account.paymentMint as PublicKey).toBase58(),
    payment_amount: (account.paymentAmount as BN).toString(),
    status,
    deadline: (account.deadline as BN).toNumber(),
    verified: account.verified as boolean,
    created_at: (account.createdAt as BN).toNumber(),
  };
}

function discoveryUrl(base: string, path: string): URL {
  return new URL(path.replace(/^\//, ''), base.endsWith('/') ? base : `${base}/`);
}

async function resolveTokenProgram(
  cfg: Config,
  mint: PublicKey,
): Promise<PublicKey> {
  const info = await cfg.connection.getAccountInfo(mint, 'confirmed');
  if (!info) throw new Error(`payment mint ${mint.toBase58()} was not found`);
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  throw new Error(`payment mint ${mint.toBase58()} is not an SPL token mint`);
}

async function searchTasksViaDiscovery(
  cfg: Config,
  input: z.infer<typeof ListTasksArgs>,
): Promise<DiscoveryTaskResult[]> {
  if (!cfg.discoveryUrl) {
    throw new Error('SAEP_DISCOVERY_URL is required for discovery-backed task search');
  }

  const allowed = input.status ? USER_STATUS_MAP[input.status] ?? [] : null;
  if (input.status === 'bidding') return [];

  const url = discoveryUrl(cfg.discoveryUrl, '/tasks');
  if (input.capability_bit !== undefined) {
    url.searchParams.set('capability', String(input.capability_bit));
  }
  if (allowed && allowed.length > 0) {
    url.searchParams.set('status', allowed.join(','));
  }
  if (input.min_payment_usdc !== undefined) {
    url.searchParams.set('min_reward', String(Math.round(input.min_payment_usdc * 1_000_000)));
  }
  url.searchParams.set('page', '1');
  url.searchParams.set('limit', String(input.limit));

  const res = await fetch(url, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`discovery request failed (${res.status})`);
  }

  const body = await res.json() as { items?: DiscoveryTaskResult[] };
  return body.items ?? [];
}

async function resolveReleaseAgentAccount(
  cfg: Config,
  task: Record<string, unknown>,
  explicitAgentAccount?: string,
): Promise<{ address: PublicKey; operator: PublicKey }> {
  const config = resolveCluster({ cluster: cfg.cluster });
  const ar = agentRegistryProgram(cfg.provider, config);

  if (explicitAgentAccount) {
    const address = new PublicKey(explicitAgentAccount);
    const raw = await ar.account.agentAccount.fetchNullable(address) as
      | { operator: PublicKey }
      | null;
    if (!raw) throw new Error('agent_account_not_found');
    return { address, operator: raw.operator };
  }

  const assignedAgent = (task.assignedAgent as PublicKey | null | undefined) ?? null;
  if (assignedAgent) {
    const raw = await ar.account.agentAccount.fetchNullable(assignedAgent) as
      | { operator: PublicKey }
      | null;
    if (raw) {
      return { address: assignedAgent, operator: raw.operator };
    }
  }

  const didHex = bytesToHex(task.agentDid as number[]);
  const agent = await fetchAgentByDid(ar, didHex);
  if (!agent) throw new Error(`agent_not_found_for_task:${didHex}`);
  return { address: agent.address, operator: agent.operator };
}

export function buildTools(): Tool[] {
  return [
    {
      name: 'register_agent',
      description:
        'Register a new SAEP agent for the configured operator. Builds the register_agent instruction using capability bits, manifest metadata, pricing, and stake inputs. ' +
        'Returns a signed signature when auto-sign is enabled or a base64 unsigned transaction payload otherwise.',
      inputSchema: toJsonSchema(RegisterAgentArgs),
      handler: async (args, cfg) => {
        const input = RegisterAgentArgs.parse(args);
        const config = resolveCluster({ cluster: cfg.cluster });
        const ar = agentRegistryProgram(cfg.provider, config);
        const operator = cfg.keypair?.publicKey ?? cfg.provider.wallet.publicKey;
        const stakeMint = new PublicKey(input.stake_mint);
        const agentId = input.agent_id_seed ? encodeAgentId(input.agent_id_seed) : randomAgentId();
        const tokenProgramId = await resolveTokenProgram(cfg, stakeMint);

        const ix = await buildRegisterAgentIx(ar, {
          operator,
          agentId,
          manifestUri: input.metadata_uri,
          capabilityMask: capabilityMaskFrom(input.capability_bits),
          priceLamports: BigInt(input.price_lamports),
          streamRate: BigInt(input.stream_rate),
          stakeAmount: BigInt(input.stake_amount),
          stakeMint,
          operatorTokenAccount: new PublicKey(input.operator_token_account),
          capabilityRegistryProgramId: config.programIds.capabilityRegistry,
          tokenProgramId,
        });

        const outcome = await signOrSerialize(cfg, ix, operator);
        const response: Record<string, unknown> = {
          cluster: cfg.cluster,
          ...outcome,
          agent_address: null,
          agent_did_hex: null,
          agent_id_hex: bytesToHex(agentId),
        };

        if (outcome.signed) {
          const registered = await fetchAgentsByOperator(ar, operator);
          const created = registered.find((item) => Buffer.from(item.agentId).equals(Buffer.from(agentId)));
          if (created) {
            response.agent_address = created.address.toBase58();
            response.agent_did_hex = bytesToHex(created.did);
          }
        }

        return response;
      },
    },
    {
      name: 'list_tasks',
      description:
        'Browse task_market tasks filtered by discovery-backed status/capability criteria. Returns up to `limit` rows. ' +
        'When SAEP_DISCOVERY_URL is configured, capability-aware search is served by the discovery index and hydrated with on-chain task addresses.',
      inputSchema: toJsonSchema(ListTasksArgs),
      handler: async (args, cfg) => {
        const input = ListTasksArgs.parse(args);
        const config = resolveCluster({ cluster: cfg.cluster });
        const tm = taskMarketProgram(cfg.provider, config);
        const allowed = input.status ? USER_STATUS_MAP[input.status] : null;
        const minPay = input.min_payment_usdc !== undefined
          ? BigInt(Math.round(input.min_payment_usdc * 1_000_000))
          : null;
        const discoveryTasks = cfg.discoveryUrl ? await searchTasksViaDiscovery(cfg, input) : null;

        if (!cfg.discoveryUrl && input.capability_bit !== undefined) {
          return {
            cluster: cfg.cluster,
            tasks: [],
            error: 'DISCOVERY_URL_REQUIRED',
            reason: 'capability_bit search now routes through the discovery service; set SAEP_DISCOVERY_URL.',
          };
        }
        if (discoveryTasks && discoveryTasks.length === 0) {
          return {
            cluster: cfg.cluster,
            tasks: [],
            total_matched: 0,
          };
        }

        const accounts = await tm.account.taskContract.all();
        const mapped = accounts.map(({ publicKey, account }) =>
          mapTaskAccount(publicKey, account as unknown as Record<string, unknown>));

        let filtered = mapped.filter((task) => {
          if (allowed && !allowed.includes(task.status)) return false;
          if (minPay !== null && BigInt(task.payment_amount) < minPay) return false;
          return true;
        });

        if (discoveryTasks) {
          const ranks = new Map(discoveryTasks.map((task, index) => [task.task_id_hex, index]));
          filtered = filtered
            .filter((task) => ranks.has(task.task_id_hex))
            .sort((a, b) => (ranks.get(a.task_id_hex) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b.task_id_hex) ?? Number.MAX_SAFE_INTEGER));
        }

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

        const ix = await buildCommitBidIx(tm, config, {
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
        const ix = await buildSubmitResultIx(tm, config, {
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
    {
      name: 'claim_payout',
      description:
        'Release escrow for a verified task after its dispute window closes. Derives the agent/operator token accounts automatically ' +
        'when possible and returns a signed signature or unsigned transaction payload.',
      inputSchema: toJsonSchema(ClaimPayoutArgs),
      handler: async (args, cfg) => {
        const input = ClaimPayoutArgs.parse(args);
        const config = resolveCluster({ cluster: cfg.cluster });
        const tm = taskMarketProgram(cfg.provider, config);

        const taskPk = new PublicKey(input.task_address);
        const task = (await tm.account.taskContract.fetchNullable(taskPk)) as
          | Record<string, unknown>
          | null;
        if (!task) return { cluster: cfg.cluster, error: 'task_not_found' };

        const marketGlobal = await fetchMarketGlobal(tm);
        if (!marketGlobal) {
          return { cluster: cfg.cluster, error: 'market_global_not_found' };
        }

        const paymentMint = task.paymentMint as PublicKey;
        const tokenProgramId = await resolveTokenProgram(cfg, paymentMint);
        const agentAccount = await resolveReleaseAgentAccount(cfg, task, input.agent_account_address);
        const agentTokenAccount = input.agent_token_account
          ? new PublicKey(input.agent_token_account)
          : getAssociatedTokenAddressSync(paymentMint, agentAccount.operator, true, tokenProgramId);
        const feeCollectorTokenAccount = getAssociatedTokenAddressSync(
          paymentMint,
          marketGlobal.feeCollector,
          true,
          tokenProgramId,
        );
        const solrepPoolTokenAccount = getAssociatedTokenAddressSync(
          paymentMint,
          marketGlobal.solrepPool,
          true,
          tokenProgramId,
        );
        const cranker = cfg.keypair?.publicKey ?? cfg.provider.wallet.publicKey;

        const ix = await buildReleaseIx(tm, config, {
          cranker,
          task: taskPk,
          paymentMint,
          agentTokenAccount,
          feeCollectorTokenAccount,
          solrepPoolTokenAccount,
          agentAccount: agentAccount.address,
          client: task.client as PublicKey,
          tokenProgramId,
        });
        const outcome = await signOrSerialize(cfg, ix, cranker);

        return {
          cluster: cfg.cluster,
          ...outcome,
          task_address: taskPk.toBase58(),
          task_id_hex: bytesToHex(task.taskId as number[]),
          payment_mint: paymentMint.toBase58(),
          payment_amount: (task.paymentAmount as BN).toString(),
          agent_account_address: agentAccount.address.toBase58(),
          agent_token_account: agentTokenAccount.toBase58(),
          fee_collector_token_account: feeCollectorTokenAccount.toBase58(),
          solrep_pool_token_account: solrepPoolTokenAccount.toBase58(),
        };
      },
    },
    {
      name: 'withdraw_earnings',
      description:
        'Withdraw accrued earnings from a treasury payment stream. Same-mint withdrawals work directly; cross-mint withdrawals require route_data_base64 plus Jupiter and oracle accounts.',
      inputSchema: toJsonSchema(WithdrawEarningsArgs),
      handler: async (args, cfg) => {
        const input = WithdrawEarningsArgs.parse(args);
        const config = resolveCluster({ cluster: cfg.cluster });
        const treasury = treasuryStandardProgram(cfg.provider, config);

        const streamPk = new PublicKey(input.stream_address);
        const stream = (await treasury.account.paymentStream.fetchNullable(streamPk)) as
          | { agentDid: number[]; payerMint: PublicKey; payoutMint: PublicKey }
          | null;
        if (!stream) return { cluster: cfg.cluster, error: 'stream_not_found' };

        const agentDid = Uint8Array.from(stream.agentDid);
        const agentDidHex = bytesToHex(agentDid);
        const swapped = !stream.payerMint.equals(stream.payoutMint);
        if (swapped && !input.route_data_base64) {
          return {
            cluster: cfg.cluster,
            error: 'swap_route_required',
            agent_did_hex: agentDidHex,
            reason: 'cross-mint withdrawals need route_data_base64 plus Jupiter + oracle accounts',
          };
        }
        if (swapped && (!input.jupiter_program || !input.payer_price_feed || !input.payout_price_feed)) {
          return {
            cluster: cfg.cluster,
            error: 'swap_accounts_required',
            agent_did_hex: agentDidHex,
            reason: 'cross-mint withdrawals need jupiter_program, payer_price_feed, and payout_price_feed',
          };
        }

        const operator = cfg.keypair?.publicKey ?? cfg.provider.wallet.publicKey;
        const routeData = input.route_data_base64
          ? Uint8Array.from(Buffer.from(input.route_data_base64, 'base64'))
          : new Uint8Array();
        const tokenProgramId = await resolveTokenProgram(cfg, stream.payerMint);
        const ix = await buildWithdrawEarnedIx(treasury, {
          operator,
          agentDid,
          stream: streamPk,
          payerMint: stream.payerMint,
          payoutMint: stream.payoutMint,
          jupiterProgram: input.jupiter_program ? new PublicKey(input.jupiter_program) : PublicKey.default,
          routeData,
          payerPriceFeed: input.payer_price_feed ? new PublicKey(input.payer_price_feed) : undefined,
          payoutPriceFeed: input.payout_price_feed ? new PublicKey(input.payout_price_feed) : undefined,
          tokenProgramId,
        });
        const outcome = await signOrSerialize(cfg, ix, operator);

        return {
          cluster: cfg.cluster,
          ...outcome,
          stream_address: streamPk.toBase58(),
          agent_did_hex: agentDidHex,
          payer_mint: stream.payerMint.toBase58(),
          payout_mint: stream.payoutMint.toBase58(),
          swapped,
        };
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
