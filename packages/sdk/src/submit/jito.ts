import {
  Transaction,
  VersionedTransaction,
  type SendOptions,
} from '@solana/web3.js';
import bs58 from 'bs58';

export interface JitoSubmitterConfig {
  blockEngineUrl: string;
  authToken?: string;
  retries?: number;
  fetchImpl?: typeof fetch;
}

export type InflightBundleStatus =
  | { state: 'Pending' }
  | { state: 'Landed'; slot: number }
  | { state: 'Failed'; reason: string }
  | { state: 'Unknown' };

export interface TipAccount {
  pubkey: string;
}

export class JitoError extends Error {
  constructor(
    public readonly kind: 'rate_limited' | 'server' | 'client' | 'network' | 'rpc',
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'JitoError';
  }
}

export interface ClampTipOptions {
  floor: number;
  cap: number;
  paymentAmount?: number;
  paymentPct?: number;
}

export function clampTipLamports(tipLamports: number, opts: ClampTipOptions): number {
  if (!Number.isFinite(tipLamports) || tipLamports < 0) tipLamports = 0;
  const floor = Math.max(0, Math.floor(opts.floor));
  const capAbs = Math.max(floor, Math.floor(opts.cap));

  let payCap = capAbs;
  if (
    typeof opts.paymentAmount === 'number' &&
    opts.paymentAmount > 0 &&
    typeof opts.paymentPct === 'number' &&
    opts.paymentPct > 0
  ) {
    payCap = Math.floor(opts.paymentAmount * opts.paymentPct);
  }

  const effectiveCap = Math.min(capAbs, payCap);
  const raw = Math.ceil(tipLamports);
  const clamped = Math.min(Math.max(raw, floor), Math.max(effectiveCap, floor));
  return clamped;
}

function encodeTx(tx: Transaction | VersionedTransaction): string {
  const buf =
    tx instanceof VersionedTransaction
      ? tx.serialize()
      : tx.serialize({ verifySignatures: false });
  return bs58.encode(buf);
}

export class JitoBundleSubmitter {
  private readonly url: string;
  private readonly retries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly authToken?: string;

  constructor(config: JitoSubmitterConfig) {
    if (!config.blockEngineUrl) throw new Error('blockEngineUrl required');
    this.url = config.blockEngineUrl.replace(/\/$/, '');
    this.retries = config.retries ?? 2;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.authToken = config.authToken;
  }

  async submitBundle(
    txs: (Transaction | VersionedTransaction)[],
    opts?: { retries?: number },
  ): Promise<string> {
    if (txs.length === 0) throw new Error('submitBundle: empty tx list');
    if (txs.length > 5) throw new Error('submitBundle: max 5 txs per bundle');

    const encoded = txs.map(encodeTx);
    const attempts = (opts?.retries ?? this.retries) + 1;
    let lastError: Error | null = null;

    for (let i = 0; i < attempts; i++) {
      try {
        const result = await this.rpc<string>('sendBundle', [encoded]);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (err instanceof JitoError && err.kind === 'client') throw err;
      }
    }
    throw lastError ?? new JitoError('network', 'sendBundle failed with no error');
  }

  async getInflightBundleStatus(bundleId: string): Promise<InflightBundleStatus> {
    try {
      const res = await this.rpc<{
        value: Array<{
          bundle_id: string;
          status: string;
          slot?: number;
          err?: { msg?: string } | null;
        }>;
      }>('getInflightBundleStatuses', [[bundleId]]);
      const entry = res.value?.[0];
      if (!entry) return { state: 'Unknown' };
      switch (entry.status) {
        case 'Landed':
          return { state: 'Landed', slot: entry.slot ?? 0 };
        case 'Failed':
          return { state: 'Failed', reason: entry.err?.msg ?? 'unknown' };
        case 'Pending':
        case 'Invalid':
          return { state: 'Pending' };
        default:
          return { state: 'Unknown' };
      }
    } catch (err) {
      if (err instanceof JitoError) throw err;
      throw new JitoError('network', err instanceof Error ? err.message : String(err));
    }
  }

  async getTipAccounts(): Promise<TipAccount[]> {
    const res = await this.rpc<string[]>('getTipAccounts', []);
    return (res ?? []).map((pubkey) => ({ pubkey }));
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.authToken) headers['x-jito-auth'] = this.authToken;

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.url}/api/v1/bundles`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
    } catch (err) {
      throw new JitoError('network', err instanceof Error ? err.message : String(err));
    }

    if (res.status === 429) {
      throw new JitoError('rate_limited', `jito 429`, 429);
    }
    if (res.status >= 500) {
      throw new JitoError('server', `jito ${res.status}: ${await safeText(res)}`, res.status);
    }
    if (!res.ok) {
      throw new JitoError('client', `jito ${res.status}: ${await safeText(res)}`, res.status);
    }

    const body = (await res.json()) as { result?: T; error?: { message?: string } };
    if (body.error) {
      throw new JitoError('rpc', body.error.message ?? 'rpc error');
    }
    return body.result as T;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

export interface BundleFallbackOptions {
  allowFallback: boolean;
  sendRaw?: (raw: Uint8Array, opts?: SendOptions) => Promise<string>;
}

export async function submitBundleOrFallback(
  submitter: JitoBundleSubmitter,
  txs: (Transaction | VersionedTransaction)[],
  opts: BundleFallbackOptions,
): Promise<{ bundleId?: string; signatures?: string[]; fallback: boolean }> {
  try {
    const bundleId = await submitter.submitBundle(txs);
    return { bundleId, fallback: false };
  } catch (err) {
    if (!opts.allowFallback || !opts.sendRaw) throw err;
    const sigs: string[] = [];
    for (const tx of txs) {
      const raw =
        tx instanceof VersionedTransaction
          ? tx.serialize()
          : tx.serialize({ verifySignatures: false });
      sigs.push(await opts.sendRaw(raw));
    }
    return { signatures: sigs, fallback: true };
  }
}
