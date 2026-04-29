// Capability-aware bid + reveal automation. Bids only on tasks the agent
// scores above its capability threshold and tracks nonces locally so the
// reveal phase auto-fires once the bid book transitions. Designed to run
// alongside the QVAC inference loop in src/index.ts; the agent both bids
// and executes if it wins.

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AnchorProvider } from '@coral-xyz/anchor';
import {
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  buildCommitBidIx,
  buildRevealBidIx,
  fetchBidBook,
  type AgentDetail,
  type ClusterConfig,
  type TaskMarket,
} from '@saep/sdk';
import type { Program } from '@coral-xyz/anchor';

export type StoredBid = { amount: string; nonceHex: string };

export type MintInfo = { decimals: number; tokenProgramId: PublicKey };

export type BidConfig = {
  enableBids: boolean;
  maxSpendUi: string;
  bidPctBps: number;
  nonceStorePath: string;
};

export function computeCommitHash(amount: bigint, nonce: Uint8Array): Uint8Array {
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(amount);
  return createHash('sha256').update(amountBuf).update(nonce).digest();
}

export function toBaseUnits(amount: string, decimals: number): bigint {
  const [whole, fraction = ''] = amount.trim().split('.');
  const padded = `${fraction}${'0'.repeat(decimals)}`.slice(0, decimals);
  return BigInt(`${whole}${padded}`);
}

export function readStore(path: string): Record<string, StoredBid> {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, StoredBid>;
  } catch {
    return {};
  }
}

export function writeStore(path: string, store: Record<string, StoredBid>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`);
}

export class MintInfoCache {
  private readonly cache = new Map<string, MintInfo>();

  constructor(private readonly connection: Connection) {}

  async get(mint: PublicKey): Promise<MintInfo> {
    const key = mint.toBase58();
    const hit = this.cache.get(key);
    if (hit) return hit;
    const acct = await this.connection.getAccountInfo(mint, 'confirmed');
    if (!acct) throw new Error(`mint ${key} not found`);
    const tokenProgramId = acct.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;
    const meta = await getMint(this.connection, mint, 'confirmed', tokenProgramId);
    const info: MintInfo = { decimals: meta.decimals, tokenProgramId };
    this.cache.set(key, info);
    return info;
  }
}

export type BidContext = {
  provider: AnchorProvider;
  connection: Connection;
  cluster: ClusterConfig;
  market: Program<TaskMarket>;
  keypair: Keypair;
  agent: AgentDetail;
  mintCache: MintInfoCache;
  store: Record<string, StoredBid>;
  config: BidConfig;
};

export async function maybeCommitBid(
  ctx: BidContext,
  task: { address: PublicKey; taskId: Uint8Array; paymentMint: PublicKey; paymentAmount: bigint },
): Promise<{ committed: boolean; signature?: string; bidAmount?: bigint; reason?: string }> {
  const taskIdHex = Buffer.from(task.taskId).toString('hex');
  const bidBook = await fetchBidBook(ctx.market, task.taskId);
  if (!bidBook) return { committed: false, reason: 'no_bid_book' };
  if (bidBook.phase !== 'commit') return { committed: false, reason: `phase_${bidBook.phase}` };
  if (ctx.store[taskIdHex]) return { committed: false, reason: 'already_committed' };

  const meta = await ctx.mintCache.get(task.paymentMint);
  const maxSpend = toBaseUnits(ctx.config.maxSpendUi, meta.decimals);
  if (task.paymentAmount > maxSpend) {
    return { committed: false, reason: 'exceeds_max_spend' };
  }

  const bidAmount = (task.paymentAmount * BigInt(ctx.config.bidPctBps)) / 10_000n;
  if (!ctx.config.enableBids) {
    return { committed: false, bidAmount, reason: 'dry_run' };
  }

  const bidderTokenAccount = getAssociatedTokenAddressSync(
    task.paymentMint,
    ctx.keypair.publicKey,
    false,
    meta.tokenProgramId,
  );
  const nonce = randomBytes(32);
  const commitHash = computeCommitHash(bidAmount, nonce);
  const ix = await buildCommitBidIx(ctx.market, ctx.cluster, {
    bidder: ctx.keypair.publicKey,
    task: task.address,
    taskId: task.taskId,
    paymentMint: task.paymentMint,
    bidderTokenAccount,
    agentOperator: ctx.agent.operator,
    agentId: ctx.agent.agentId,
    agentDid: ctx.agent.did,
    commitHash,
    tokenProgramId: meta.tokenProgramId,
  });
  const sig = await ctx.provider.sendAndConfirm(new Transaction().add(ix), [], {
    commitment: 'confirmed',
  });
  ctx.store[taskIdHex] = {
    amount: bidAmount.toString(),
    nonceHex: Buffer.from(nonce).toString('hex'),
  };
  writeStore(ctx.config.nonceStorePath, ctx.store);
  return { committed: true, signature: sig, bidAmount };
}

export async function maybeRevealBid(
  ctx: BidContext,
  task: { address: PublicKey; taskId: Uint8Array },
): Promise<{ revealed: boolean; signature?: string; reason?: string }> {
  const taskIdHex = Buffer.from(task.taskId).toString('hex');
  const stored = ctx.store[taskIdHex];
  if (!stored) return { revealed: false, reason: 'no_stored_bid' };
  const bidBook = await fetchBidBook(ctx.market, task.taskId);
  if (!bidBook) return { revealed: false, reason: 'no_bid_book' };
  if (bidBook.phase !== 'reveal') return { revealed: false, reason: `phase_${bidBook.phase}` };

  if (!ctx.config.enableBids) return { revealed: false, reason: 'dry_run' };

  const ix = await buildRevealBidIx(ctx.market, {
    bidder: ctx.keypair.publicKey,
    task: task.address,
    taskId: task.taskId,
    amount: BigInt(stored.amount),
    nonce: Buffer.from(stored.nonceHex, 'hex'),
  });
  const sig = await ctx.provider.sendAndConfirm(new Transaction().add(ix), [], {
    commitment: 'confirmed',
  });
  delete ctx.store[taskIdHex];
  writeStore(ctx.config.nonceStorePath, ctx.store);
  return { revealed: true, signature: sig };
}
