import { describe, expect, it } from 'vitest';
import pino from 'pino';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Keypair } from '@solana/web3.js';
import {
  AnchorWorkerPool,
  DEFAULT_PAYLOAD_VERSION,
  loadAnchorSigner,
  MEMO_PROGRAM_ID,
  type AnchorSubmitter,
} from '../anchor.js';
import type { Envelope } from '../schema.js';

const log = pino({ level: 'silent' });

function envelope(overrides: Partial<Envelope> = {}): Envelope {
  return {
    id: '01HXXX00000000000000000001',
    topic: 'task.' + 'a'.repeat(64) + '.events',
    from_agent: '11111111111111111111111111111111',
    to_agent: null,
    payload_cid: 'bafy-test',
    payload_digest: '0'.repeat(64),
    signature: 'sig',
    ts: 1_700_000_000_000,
    ...overrides,
  };
}

class FakeSubmitter implements AnchorSubmitter {
  calls: string[] = [];
  failUntil = 0;
  delayMs = 0;

  async submit(memo: string): Promise<string> {
    this.calls.push(memo);
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.calls.length <= this.failUntil) {
      throw new Error(`transient-${this.calls.length}`);
    }
    return `sig-${this.calls.length}`;
  }
}

async function waitFor(pred: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('waitFor timed out');
}

describe('AnchorWorkerPool — filter', () => {
  it('skips non-task topics', () => {
    const sub = new FakeSubmitter();
    const pool = new AnchorWorkerPool(sub, log);
    pool.start();
    const outcome = pool.enqueue(envelope({ topic: 'agent.AbC123.inbox' }));
    expect(outcome).toBe('skipped');
    expect(sub.calls).toHaveLength(0);
  });

  it('accepts task topics', async () => {
    const sub = new FakeSubmitter();
    const pool = new AnchorWorkerPool(sub, log);
    pool.start();
    const outcome = pool.enqueue(envelope());
    expect(outcome).toBe('queued');
    await waitFor(() => sub.calls.length === 1);
    await pool.stop();
  });

  it('honors custom topicPrefix', () => {
    const sub = new FakeSubmitter();
    const pool = new AnchorWorkerPool(sub, log, { topicPrefix: 'payment.' });
    pool.start();
    expect(pool.enqueue(envelope({ topic: 'task.xyz.events' }))).toBe('skipped');
    // payment.* isn't a valid zod topic but the pool only checks prefix.
    expect(pool.enqueue(envelope({ topic: 'payment.foo' }))).toBe('queued');
  });
});

describe('AnchorWorkerPool — memo payload', () => {
  it('uses deterministic sha256(id|digest|ts) with version prefix', () => {
    const sub = new FakeSubmitter();
    const pool = new AnchorWorkerPool(sub, log);
    const memo = pool.buildMemo(envelope());
    expect(memo.startsWith(`${DEFAULT_PAYLOAD_VERSION}/`)).toBe(true);
    const hex = memo.slice(DEFAULT_PAYLOAD_VERSION.length + 1);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hash differs on any field change', () => {
    const sub = new FakeSubmitter();
    const pool = new AnchorWorkerPool(sub, log);
    const base = pool.buildMemo(envelope());
    expect(pool.buildMemo(envelope({ id: '01HXXX00000000000000000002' }))).not.toBe(base);
    expect(pool.buildMemo(envelope({ payload_digest: '1'.repeat(64) }))).not.toBe(base);
    expect(pool.buildMemo(envelope({ ts: 1_700_000_000_001 }))).not.toBe(base);
  });
});

describe('AnchorWorkerPool — concurrency + backpressure', () => {
  it('runs at most `workers` submissions in flight', async () => {
    const sub = new FakeSubmitter();
    sub.delayMs = 30;
    const pool = new AnchorWorkerPool(sub, log, { workers: 2 });
    pool.start();

    for (let i = 0; i < 5; i++) {
      pool.enqueue(envelope({ id: `01HXXX0000000000000000000${i}` }));
    }
    await new Promise((r) => setTimeout(r, 5));
    expect(pool.inFlightCount()).toBeLessThanOrEqual(2);

    await waitFor(() => sub.calls.length === 5, 2_000);
    await pool.stop();
  });

  it('drops when queue is full', () => {
    const sub = new FakeSubmitter();
    sub.delayMs = 500; // stall so queue fills
    const pool = new AnchorWorkerPool(sub, log, { workers: 1, queueCap: 2 });
    pool.start();

    // first dequeues immediately; queueCap=2 so next 2 fit, 4th rejects.
    const r1 = pool.enqueue(envelope({ id: '01HXXX00000000000000000001' }));
    const r2 = pool.enqueue(envelope({ id: '01HXXX00000000000000000002' }));
    const r3 = pool.enqueue(envelope({ id: '01HXXX00000000000000000003' }));
    const r4 = pool.enqueue(envelope({ id: '01HXXX00000000000000000004' }));
    expect(r1).toBe('queued');
    expect(r2).toBe('queued');
    expect(r3).toBe('queued');
    expect(r4).toBe('dropped_full');
    void pool.stop();
  });

  it('rejects enqueue when not running', () => {
    const sub = new FakeSubmitter();
    const pool = new AnchorWorkerPool(sub, log);
    expect(pool.enqueue(envelope())).toBe('not_running');
    expect(sub.calls).toHaveLength(0);
  });
});

describe('AnchorWorkerPool — retry', () => {
  it('retries transient failures up to maxRetries then gives up', async () => {
    const sub = new FakeSubmitter();
    sub.failUntil = 99; // always fail
    const pool = new AnchorWorkerPool(sub, log, {
      maxRetries: 3,
      baseRetryMs: 1,
      workers: 1,
    });
    pool.start();
    pool.enqueue(envelope());
    await waitFor(() => sub.calls.length === 3, 2_000);
    // wait for the final failure path to run (attempts===maxRetries).
    await new Promise((r) => setTimeout(r, 30));
    expect(sub.calls).toHaveLength(3);
    await pool.stop();
  });

  it('eventually succeeds when submitter recovers', async () => {
    const sub = new FakeSubmitter();
    sub.failUntil = 2;
    const pool = new AnchorWorkerPool(sub, log, {
      maxRetries: 5,
      baseRetryMs: 1,
      workers: 1,
    });
    pool.start();
    pool.enqueue(envelope());
    await waitFor(() => sub.calls.length === 3, 2_000);
    expect(sub.calls).toHaveLength(3);
    await pool.stop();
  });
});

describe('AnchorWorkerPool — lifecycle', () => {
  it('stop() waits for in-flight work to drain', async () => {
    const sub = new FakeSubmitter();
    sub.delayMs = 40;
    const pool = new AnchorWorkerPool(sub, log, { workers: 1 });
    pool.start();
    pool.enqueue(envelope());
    await new Promise((r) => setTimeout(r, 5));
    expect(pool.inFlightCount()).toBe(1);
    await pool.stop(1_000);
    expect(pool.inFlightCount()).toBe(0);
    expect(pool.isRunning()).toBe(false);
  });
});

describe('loadAnchorSigner', () => {
  it('rejects wallet files that are not 64-byte arrays', () => {
    const p = path.join(os.tmpdir(), `saep-anchor-bad-${Date.now()}.json`);
    fs.writeFileSync(p, '[1,2,3]');
    try {
      expect(() => loadAnchorSigner(p)).toThrow(/64-byte/);
    } finally {
      fs.unlinkSync(p);
    }
  });

  it('loads a valid 64-byte secret key array', () => {
    const kpGen = Keypair.generate();
    const p = path.join(os.tmpdir(), `saep-anchor-ok-${Date.now()}.json`);
    fs.writeFileSync(p, JSON.stringify(Array.from(kpGen.secretKey)));
    try {
      const kp = loadAnchorSigner(p);
      expect(kp.publicKey.toBase58()).toBe(kpGen.publicKey.toBase58());
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe('MEMO_PROGRAM_ID', () => {
  it('matches the canonical SPL Memo v2 program id', () => {
    expect(MEMO_PROGRAM_ID.toBase58()).toBe('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
  });
});
