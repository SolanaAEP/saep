import {
  ComputeBudgetProgram,
  Connection,
  Transaction,
  VersionedTransaction,
  type SendOptions,
  type TransactionSignature,
} from '@solana/web3.js';

export type PriorityLevel = 'Min' | 'Low' | 'Medium' | 'High' | 'VeryHigh' | 'UnsafeMax';

export interface PriorityFeeEstimate {
  microLamports: number;
  level: PriorityLevel | 'Default';
}

export interface PriorityFeeOptions {
  level?: PriorityLevel;
  cuLimit?: number;
  cap?: number;
  floor?: number;
}

export interface StakedSubmitterConfig {
  stakedUrl: string;
  fallbackConnection?: Connection;
  retries?: number;
  fetchImpl?: typeof fetch;
}

export interface SubmitOptions extends SendOptions {
  retries?: number;
}

const COMPUTE_BUDGET_PROGRAM_ID = ComputeBudgetProgram.programId.toBase58();

export class HeliusEstimateUnavailable extends Error {
  constructor(reason: string) {
    super(`getPriorityFeeEstimate unavailable: ${reason}`);
    this.name = 'HeliusEstimateUnavailable';
  }
}

export async function getHeliusPriorityFeeEstimate(
  rpcUrl: string,
  serializedTx: Uint8Array,
  level: PriorityLevel = 'Medium',
  fetchImpl: typeof fetch = fetch,
): Promise<PriorityFeeEstimate> {
  const txB64 = bufToBase64(serializedTx);
  const res = await fetchImpl(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'priority-fee',
      method: 'getPriorityFeeEstimate',
      params: [
        {
          transaction: txB64,
          options: { priorityLevel: level, transactionEncoding: 'base64' },
        },
      ],
    }),
  });
  if (!res.ok) throw new HeliusEstimateUnavailable(`http ${res.status}`);
  const body = (await res.json()) as {
    result?: { priorityFeeEstimate?: number };
    error?: { message?: string; code?: number };
  };
  if (body.error) throw new HeliusEstimateUnavailable(body.error.message ?? 'rpc error');
  const microLamports = body.result?.priorityFeeEstimate;
  if (typeof microLamports !== 'number' || !Number.isFinite(microLamports)) {
    throw new HeliusEstimateUnavailable('missing priorityFeeEstimate');
  }
  return { microLamports: Math.max(0, Math.ceil(microLamports)), level };
}

export function clampPriorityFee(estimate: number, opts: PriorityFeeOptions): number {
  let value = Math.max(0, Math.ceil(estimate));
  if (typeof opts.floor === 'number') value = Math.max(value, Math.ceil(opts.floor));
  if (typeof opts.cap === 'number') value = Math.min(value, Math.floor(opts.cap));
  return value;
}

export function hasComputeBudgetIx(tx: Transaction): { price: boolean; limit: boolean } {
  let price = false;
  let limit = false;
  for (const ix of tx.instructions) {
    if (ix.programId.toBase58() !== COMPUTE_BUDGET_PROGRAM_ID) continue;
    const tag = ix.data[0];
    if (tag === 2) limit = true;
    else if (tag === 3) price = true;
  }
  return { price, limit };
}

export function withPriorityFee(
  tx: Transaction,
  microLamports: number,
  cuLimit?: number,
): Transaction {
  const present = hasComputeBudgetIx(tx);
  const prefix: ReturnType<typeof ComputeBudgetProgram.setComputeUnitPrice>[] = [];
  if (typeof cuLimit === 'number' && !present.limit) {
    prefix.push(ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }));
  }
  if (microLamports > 0 && !present.price) {
    prefix.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: BigInt(microLamports) }));
  }
  if (prefix.length === 0) return tx;
  tx.instructions = [...prefix, ...tx.instructions];
  return tx;
}

function bufToBase64(buf: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(buf).toString('base64');
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!);
  return btoa(bin);
}

function serialize(tx: Transaction | VersionedTransaction): Uint8Array {
  if (tx instanceof VersionedTransaction) return tx.serialize();
  return tx.serialize({ verifySignatures: false });
}

export class StakedRpcSubmitter {
  private readonly url: string;
  private readonly fallback?: Connection;
  private readonly retries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: StakedSubmitterConfig) {
    if (!config.stakedUrl) throw new Error('stakedUrl required');
    this.url = config.stakedUrl;
    this.fallback = config.fallbackConnection;
    this.retries = config.retries ?? 2;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async submit(
    tx: Transaction | VersionedTransaction,
    opts: SubmitOptions = {},
  ): Promise<TransactionSignature> {
    return this.sendRaw(serialize(tx), opts);
  }

  async sendRaw(raw: Uint8Array, opts: SubmitOptions = {}): Promise<TransactionSignature> {
    const sendOptions: SendOptions = {
      skipPreflight: opts.skipPreflight ?? true,
      maxRetries: opts.maxRetries ?? 0,
      preflightCommitment: opts.preflightCommitment,
    };
    const attempts = (opts.retries ?? this.retries) + 1;
    let lastError: Error | null = null;
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.rpcSend(raw, sendOptions);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
    if (this.fallback) {
      return this.fallback.sendRawTransaction(raw, sendOptions);
    }
    throw lastError ?? new Error('staked submit failed');
  }

  private async rpcSend(raw: Uint8Array, opts: SendOptions): Promise<TransactionSignature> {
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'staked-send',
        method: 'sendTransaction',
        params: [
          bufToBase64(raw),
          {
            encoding: 'base64',
            skipPreflight: opts.skipPreflight,
            maxRetries: opts.maxRetries,
            preflightCommitment: opts.preflightCommitment,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`staked rpc ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as {
      result?: TransactionSignature;
      error?: { message?: string };
    };
    if (body.error) throw new Error(`staked rpc error: ${body.error.message ?? 'unknown'}`);
    if (!body.result) throw new Error('staked rpc returned no signature');
    return body.result;
  }
}
