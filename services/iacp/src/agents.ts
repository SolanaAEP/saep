import { Connection, PublicKey } from '@solana/web3.js';
import type { Logger } from 'pino';

// AgentAccount layout per programs/agent_registry/src/state.rs:
//   discriminator (8) | operator (32) | agent_id (32) | did (32)
//   | manifest_uri (128) | capability_mask (16) | price_lamports (8)
//   | stream_rate (8) | reputation (50) | jobs_completed (8)
//   | jobs_disputed (4) | stake_amount (8) | status (1)
// Status byte uses AnchorSerialize enum discriminant (declaration order):
//   Active=0 Paused=1 Suspended=2 Deregistered=3.
// If the account struct grows, update STATUS_OFFSET — localnet integration
// test gated on the agent_registry deploy should catch drift.
const OPERATOR_OFFSET = 8;
const STATUS_OFFSET = 334;
const STATUS_ACTIVE = 0;

export interface AgentLookupOptions {
  positiveTtlMs?: number;
  negativeTtlMs?: number;
  maxEntries?: number;
}

interface CacheEntry {
  active: boolean;
  expiresAt: number;
}

export interface AgentLookup {
  isActiveOperator(operatorBs58: string, now?: number): Promise<boolean>;
  invalidate(operatorBs58: string): void;
  size(): number;
}

export class RpcAgentLookup implements AgentLookup {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly positiveTtl: number;
  private readonly negativeTtl: number;
  private readonly maxEntries: number;

  constructor(
    private readonly connection: Connection,
    private readonly programId: PublicKey,
    private readonly log: Logger,
    opts: AgentLookupOptions = {},
  ) {
    this.positiveTtl = opts.positiveTtlMs ?? 30_000;
    this.negativeTtl = opts.negativeTtlMs ?? 5_000;
    this.maxEntries = opts.maxEntries ?? 1024;
  }

  async isActiveOperator(
    operatorBs58: string,
    now: number = Date.now(),
  ): Promise<boolean> {
    const hit = this.cache.get(operatorBs58);
    if (hit && hit.expiresAt > now) return hit.active;

    let operator: PublicKey;
    try {
      operator = new PublicKey(operatorBs58);
    } catch {
      this.put(operatorBs58, false, now);
      return false;
    }

    let active: boolean;
    try {
      const accounts = await this.connection.getProgramAccounts(this.programId, {
        commitment: 'confirmed',
        dataSlice: { offset: STATUS_OFFSET, length: 1 },
        filters: [
          { memcmp: { offset: OPERATOR_OFFSET, bytes: operator.toBase58() } },
        ],
      });
      active = accounts.some(
        ({ account }) =>
          account.data.length >= 1 && account.data[0] === STATUS_ACTIVE,
      );
    } catch (err) {
      this.log.warn(
        { err: err instanceof Error ? err.message : String(err), operator: operatorBs58 },
        'agent_registry lookup failed',
      );
      return false;
    }

    this.put(operatorBs58, active, now);
    return active;
  }

  invalidate(operatorBs58: string): void {
    this.cache.delete(operatorBs58);
  }

  size(): number {
    return this.cache.size;
  }

  private put(key: string, active: boolean, now: number): void {
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    const ttl = active ? this.positiveTtl : this.negativeTtl;
    this.cache.set(key, { active, expiresAt: now + ttl });
  }
}

export const agentLookupOffsets = {
  OPERATOR_OFFSET,
  STATUS_OFFSET,
  STATUS_ACTIVE,
} as const;
