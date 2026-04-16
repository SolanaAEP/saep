import {
  Connection,
  Transaction,
  VersionedTransaction,
  type SendOptions,
} from '@solana/web3.js';
import bs58 from 'bs58';

export interface JitoConfig {
  blockEngineUrl: string;
  connection: Connection;
  maxRetries?: number;
}

export interface BundleResult {
  bundleId: string;
}

export type BundleStatus =
  | { status: 'landed'; slot: number }
  | { status: 'pending' }
  | { status: 'failed'; reason: string };

const DEFAULT_BLOCK_ENGINE = 'https://mainnet.block-engine.jito.wtf';

export class JitoBundleClient {
  private readonly url: string;
  private readonly connection: Connection;
  private readonly maxRetries: number;

  constructor(config: JitoConfig) {
    this.url = config.blockEngineUrl || DEFAULT_BLOCK_ENGINE;
    this.connection = config.connection;
    this.maxRetries = config.maxRetries ?? 2;
  }

  async sendBundle(
    signedTxs: (Transaction | VersionedTransaction)[],
  ): Promise<BundleResult> {
    const encoded = signedTxs.map((tx) => {
      const buf =
        tx instanceof VersionedTransaction
          ? tx.serialize()
          : tx.serialize({ verifySignatures: false });
      return bs58.encode(buf);
    });

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.rpcCall<BundleResult>('sendBundle', [encoded]);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
    throw lastError;
  }

  async getBundleStatus(bundleId: string): Promise<BundleStatus> {
    try {
      const res = await this.rpcCall<{
        value: Array<{
          bundle_id: string;
          status: string;
          slot?: number;
          err?: { msg: string };
        }>;
      }>('getInflightBundleStatuses', [[bundleId]]);

      const entry = res.value?.[0];
      if (!entry) return { status: 'pending' };
      if (entry.status === 'Landed') return { status: 'landed', slot: entry.slot ?? 0 };
      if (entry.status === 'Failed') return { status: 'failed', reason: entry.err?.msg ?? 'unknown' };
      return { status: 'pending' };
    } catch {
      return { status: 'pending' };
    }
  }

  async sendWithFallback(
    signedTxs: (Transaction | VersionedTransaction)[],
    opts?: { allowFallback?: boolean; sendOptions?: SendOptions },
  ): Promise<{ bundleId?: string; signatures?: string[]; fallback: boolean }> {
    try {
      const result = await this.sendBundle(signedTxs);
      return { bundleId: result.bundleId, fallback: false };
    } catch {
      if (!opts?.allowFallback) throw new Error('bundle failed and fallback disabled');
      const signatures: string[] = [];
      for (const tx of signedTxs) {
        const sig = await this.connection.sendRawTransaction(
          tx instanceof VersionedTransaction
            ? tx.serialize()
            : tx.serialize({ verifySignatures: false }),
          opts?.sendOptions,
        );
        signatures.push(sig);
      }
      return { signatures, fallback: true };
    }
  }

  private async rpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(`${this.url}/api/v1/bundles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!res.ok) throw new Error(`jito rpc ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { result?: T; error?: { message: string } };
    if (body.error) throw new Error(`jito rpc error: ${body.error.message}`);
    return body.result as T;
  }
}
