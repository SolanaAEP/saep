import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import type { Logger } from 'pino';
import type { Envelope } from './schema.js';
import {
  recordAnchorDropped,
  recordAnchorEnqueued,
  recordAnchorFailed,
  recordAnchorRetried,
  recordAnchorSkipped,
  recordAnchorSubmitted,
  setAnchorQueueDepth,
  topicCategory,
} from './metrics.js';

// Canonical SPL Memo v2. v1 (Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo) is
// still callable but deprecated — v2 requires explicit signer accounts and is
// the program both indexers and RPC filter on.
export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

export const DEFAULT_TOPIC_PREFIX = 'task.';
export const DEFAULT_PAYLOAD_VERSION = 'saep/iacp/v1';
export const DEFAULT_WORKERS = 2;
export const DEFAULT_QUEUE_CAP = 1024;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_BASE_RETRY_MS = 500;

export interface AnchorSubmitter {
  submit(memo: string): Promise<string>;
}

export class RpcAnchorSubmitter implements AnchorSubmitter {
  constructor(
    private readonly connection: Connection,
    private readonly signer: Keypair,
    private readonly priorityFeeMicroLamports = 0,
  ) {}

  async submit(memo: string): Promise<string> {
    const tx = new Transaction();
    if (this.priorityFeeMicroLamports > 0) {
      tx.add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: this.priorityFeeMicroLamports,
        }),
      );
    }
    tx.add(
      new TransactionInstruction({
        keys: [{ pubkey: this.signer.publicKey, isSigner: true, isWritable: false }],
        programId: MEMO_PROGRAM_ID,
        data: Buffer.from(memo, 'utf8'),
      }),
    );
    const bh = await this.connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = bh.blockhash;
    tx.feePayer = this.signer.publicKey;
    tx.sign(this.signer);
    const sig = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 0,
    });
    await this.connection.confirmTransaction(
      { signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
      'confirmed',
    );
    return sig;
  }
}

export interface AnchorOptions {
  workers?: number;
  queueCap?: number;
  maxRetries?: number;
  baseRetryMs?: number;
  topicPrefix?: string;
  payloadVersion?: string;
}

interface QueueItem {
  envelope: Envelope;
  attempts: number;
  enqueuedAt: number;
}

export type EnqueueOutcome = 'queued' | 'skipped' | 'dropped_full' | 'not_running';

export class AnchorWorkerPool {
  private readonly queue: QueueItem[] = [];
  private inFlight = 0;
  private running = false;
  private readonly workers: number;
  private readonly queueCap: number;
  private readonly maxRetries: number;
  private readonly baseRetryMs: number;
  private readonly topicPrefix: string;
  private readonly payloadVersion: string;

  constructor(
    private readonly submitter: AnchorSubmitter,
    private readonly log: Logger,
    opts: AnchorOptions = {},
  ) {
    this.workers = Math.max(1, opts.workers ?? DEFAULT_WORKERS);
    this.queueCap = Math.max(1, opts.queueCap ?? DEFAULT_QUEUE_CAP);
    this.maxRetries = Math.max(1, opts.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.baseRetryMs = Math.max(1, opts.baseRetryMs ?? DEFAULT_BASE_RETRY_MS);
    this.topicPrefix = opts.topicPrefix ?? DEFAULT_TOPIC_PREFIX;
    this.payloadVersion = opts.payloadVersion ?? DEFAULT_PAYLOAD_VERSION;
  }

  shouldAnchor(topic: string): boolean {
    return topic.startsWith(this.topicPrefix);
  }

  // Memo payload = `<version>/<sha256(id|digest|ts)>`. sha256 is already the
  // hash function used on payload_digest; we combine it with id+ts so the
  // memo deterministically pins envelope identity, not just payload content.
  buildMemo(env: Envelope): string {
    const h = createHash('sha256');
    h.update(env.id);
    h.update('|');
    h.update(env.payload_digest);
    h.update('|');
    h.update(String(env.ts));
    return `${this.payloadVersion}/${h.digest('hex')}`;
  }

  enqueue(env: Envelope): EnqueueOutcome {
    if (!this.shouldAnchor(env.topic)) {
      recordAnchorSkipped(topicCategory(env.topic));
      return 'skipped';
    }
    if (!this.running) {
      recordAnchorDropped('not_running');
      return 'not_running';
    }
    if (this.queue.length >= this.queueCap) {
      recordAnchorDropped('queue_full');
      return 'dropped_full';
    }
    this.queue.push({ envelope: env, attempts: 0, enqueuedAt: Date.now() });
    setAnchorQueueDepth(this.queue.length);
    recordAnchorEnqueued();
    this.maybeStart();
    return 'queued';
  }

  start(): void {
    this.running = true;
    this.maybeStart();
  }

  async stop(timeoutMs = 5_000): Promise<void> {
    this.running = false;
    const deadline = Date.now() + timeoutMs;
    while (this.inFlight > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  depth(): number {
    return this.queue.length;
  }

  inFlightCount(): number {
    return this.inFlight;
  }

  isRunning(): boolean {
    return this.running;
  }

  private maybeStart(): void {
    if (!this.running) return;
    while (this.inFlight < this.workers && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;
      setAnchorQueueDepth(this.queue.length);
      this.inFlight += 1;
      void this.process(item);
    }
  }

  private async process(item: QueueItem): Promise<void> {
    const memo = this.buildMemo(item.envelope);
    const start = performance.now();
    try {
      const sig = await this.submitter.submit(memo);
      recordAnchorSubmitted((performance.now() - start) / 1000);
      this.log.debug(
        { sig, envelopeId: item.envelope.id, topic: item.envelope.topic },
        'anchor submitted',
      );
    } catch (err) {
      item.attempts += 1;
      const errMsg = err instanceof Error ? err.message : String(err);
      if (item.attempts >= this.maxRetries) {
        recordAnchorFailed('max_retries');
        this.log.warn(
          { envelopeId: item.envelope.id, attempts: item.attempts, err: errMsg },
          'anchor failed permanently',
        );
      } else {
        const delay = this.baseRetryMs * 2 ** (item.attempts - 1);
        recordAnchorRetried();
        const handle = setTimeout(() => {
          if (!this.running) return;
          this.queue.unshift(item);
          setAnchorQueueDepth(this.queue.length);
          this.maybeStart();
        }, delay);
        handle.unref?.();
      }
    } finally {
      this.inFlight -= 1;
      this.maybeStart();
    }
  }
}

export function loadAnchorSigner(path: string): Keypair {
  const mode = statSync(path).mode & 0o777;
  if (mode & 0o044) {
    process.stderr.write(
      `WARNING: keypair file ${path} has permissions ${mode.toString(8).padStart(4, '0')}, recommended 0600\n`,
    );
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as number[];
  if (!Array.isArray(raw) || raw.length !== 64) {
    throw new Error(`anchor wallet at ${path} is not a 64-byte secret key array`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function parseIntEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function buildAnchor(log: Logger): AnchorWorkerPool | null {
  const enabled = (process.env.IACP_ANCHOR_ENABLED ?? '').toLowerCase() === 'true';
  if (!enabled) return null;
  const rpcUrl = (process.env.IACP_ANCHOR_RPC_URL ?? process.env.SOLANA_RPC_URL ?? '').trim();
  const walletPath = (process.env.IACP_ANCHOR_WALLET_PATH ?? '').trim();
  if (!rpcUrl || !walletPath) {
    log.warn(
      { hasRpc: !!rpcUrl, hasWallet: !!walletPath },
      'IACP_ANCHOR_ENABLED=true but RPC URL or wallet path missing — anchor disabled',
    );
    return null;
  }
  let signer: Keypair;
  try {
    signer = loadAnchorSigner(walletPath);
  } catch (err) {
    log.error(
      { walletPath, err: err instanceof Error ? err.message : String(err) },
      'anchor wallet load failed — anchor disabled',
    );
    return null;
  }
  const priority = parseIntEnv(process.env.IACP_ANCHOR_PRIORITY_FEE_MICROLAMPORTS, 0);
  const connection = new Connection(rpcUrl, 'confirmed');
  const submitter = new RpcAnchorSubmitter(connection, signer, priority);
  const pool = new AnchorWorkerPool(submitter, log, {
    workers: parseIntEnv(process.env.IACP_ANCHOR_WORKERS, DEFAULT_WORKERS),
    queueCap: parseIntEnv(process.env.IACP_ANCHOR_QUEUE_CAP, DEFAULT_QUEUE_CAP),
    maxRetries: parseIntEnv(process.env.IACP_ANCHOR_MAX_RETRIES, DEFAULT_MAX_RETRIES),
    baseRetryMs: parseIntEnv(process.env.IACP_ANCHOR_BASE_RETRY_MS, DEFAULT_BASE_RETRY_MS),
  });
  pool.start();
  log.info({ signer: signer.publicKey.toBase58() }, 'anchor worker pool enabled');
  return pool;
}
