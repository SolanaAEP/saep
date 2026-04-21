import { describe, expect, it, vi } from 'vitest';
import {
  Keypair,
  MessageV0,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  JitoBundleSubmitter,
  JitoError,
  clampTipLamports,
  submitBundleOrFallback,
} from '../jito.js';

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
    handler(typeof url === 'string' ? url : url.toString(), init),
  ) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function buildTx(): Transaction {
  const from = Keypair.generate();
  const to = Keypair.generate();
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to.publicKey,
      lamports: 1,
    }),
  );
  tx.recentBlockhash = '11111111111111111111111111111111';
  tx.feePayer = from.publicKey;
  return tx;
}

function buildVersionedTx(): VersionedTransaction {
  const payer = Keypair.generate();
  const msg = MessageV0.compile({
    payerKey: payer.publicKey,
    recentBlockhash: '11111111111111111111111111111111',
    instructions: [
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: new PublicKey('11111111111111111111111111111112'),
        lamports: 1,
      }),
    ],
  });
  const tx = new VersionedTransaction(msg);
  tx.sign([payer]);
  return tx;
}

describe('clampTipLamports', () => {
  it('raises tip below floor to floor', () => {
    expect(clampTipLamports(500, { floor: 1_000, cap: 1_000_000 })).toBe(1_000);
  });

  it('caps tip above absolute cap', () => {
    expect(clampTipLamports(5_000_000, { floor: 1_000, cap: 100_000 })).toBe(100_000);
  });

  it('caps tip at 1% of payment amount when lower than absolute cap', () => {
    const tip = clampTipLamports(1_000_000, {
      floor: 1_000,
      cap: 500_000,
      paymentAmount: 10_000_000,
      paymentPct: 0.01,
    });
    expect(tip).toBe(100_000);
  });

  it('preserves tip within [floor, cap] window', () => {
    expect(clampTipLamports(42_000, { floor: 1_000, cap: 1_000_000 })).toBe(42_000);
  });

  it('prefers floor when floor exceeds absolute cap (edge: misconfigured)', () => {
    expect(clampTipLamports(10_000, { floor: 50_000, cap: 10_000 })).toBe(50_000);
  });

  it('falls back to absolute cap when payment amount is zero', () => {
    expect(
      clampTipLamports(500_000, {
        floor: 1_000,
        cap: 100_000,
        paymentAmount: 0,
        paymentPct: 0.01,
      }),
    ).toBe(100_000);
  });

  it('rounds fractional tips up and treats negative/NaN as zero-then-floored', () => {
    expect(clampTipLamports(1_500.2, { floor: 1_000, cap: 10_000 })).toBe(1_501);
    expect(clampTipLamports(-10, { floor: 1_000, cap: 10_000 })).toBe(1_000);
    expect(clampTipLamports(Number.NaN, { floor: 1_000, cap: 10_000 })).toBe(1_000);
  });
});

describe('JitoBundleSubmitter', () => {
  it('POSTs sendBundle with base58-encoded txs and returns bundleId', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse({ jsonrpc: '2.0', id: 1, result: 'bundle-xyz' }),
    );
    const submitter = new JitoBundleSubmitter({
      blockEngineUrl: 'https://bl.example',
      retries: 0,
      fetchImpl,
    });
    const id = await submitter.submitBundle([buildTx()]);
    expect(id).toBe('bundle-xyz');
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://bl.example/api/v1/bundles');
    const body = JSON.parse(init!.body as string);
    expect(body.method).toBe('sendBundle');
    expect(Array.isArray(body.params[0])).toBe(true);
    expect(typeof body.params[0][0]).toBe('string');
  });

  it('throws JitoError rate_limited on 429 and stops retrying on client 4xx', async () => {
    let calls = 0;
    const fetchImpl = fakeFetch(() => {
      calls++;
      return new Response('rate', { status: 429 });
    });
    const submitter = new JitoBundleSubmitter({
      blockEngineUrl: 'https://bl.example',
      retries: 2,
      fetchImpl,
    });
    await expect(submitter.submitBundle([buildTx()])).rejects.toMatchObject({
      name: 'JitoError',
      kind: 'rate_limited',
    });
    expect(calls).toBe(3);
  });

  it('does not retry 4xx client errors', async () => {
    let calls = 0;
    const fetchImpl = fakeFetch(() => {
      calls++;
      return new Response('nope', { status: 400 });
    });
    const submitter = new JitoBundleSubmitter({
      blockEngineUrl: 'https://bl.example',
      retries: 3,
      fetchImpl,
    });
    await expect(submitter.submitBundle([buildTx()])).rejects.toBeInstanceOf(JitoError);
    expect(calls).toBe(1);
  });

  it('parses Landed/Failed/Pending inflight statuses', async () => {
    const responses = [
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: { value: [{ bundle_id: 'b', status: 'Landed', slot: 42 }] },
      }),
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: { value: [{ bundle_id: 'b', status: 'Failed', err: { msg: 'slot miss' } }] },
      }),
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: { value: [{ bundle_id: 'b', status: 'Pending' }] },
      }),
    ];
    let idx = 0;
    const fetchImpl = fakeFetch(() => responses[idx++]!);
    const submitter = new JitoBundleSubmitter({
      blockEngineUrl: 'https://bl.example',
      retries: 0,
      fetchImpl,
    });
    expect(await submitter.getInflightBundleStatus('b')).toEqual({ state: 'Landed', slot: 42 });
    expect(await submitter.getInflightBundleStatus('b')).toEqual({
      state: 'Failed',
      reason: 'slot miss',
    });
    expect(await submitter.getInflightBundleStatus('b')).toEqual({ state: 'Pending' });
  });

  it('rejects empty or oversized bundles', async () => {
    const submitter = new JitoBundleSubmitter({
      blockEngineUrl: 'https://bl.example',
      retries: 0,
      fetchImpl: fakeFetch(() => jsonResponse({ result: '' })),
    });
    await expect(submitter.submitBundle([])).rejects.toThrow(/empty/);
    await expect(
      submitter.submitBundle([buildTx(), buildTx(), buildTx(), buildTx(), buildTx(), buildTx()]),
    ).rejects.toThrow(/max 5/);
  });

  it('sends x-jito-auth header when authToken configured and encodes VersionedTransaction', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse({ jsonrpc: '2.0', id: 1, result: 'bundle-v0' }),
    );
    const submitter = new JitoBundleSubmitter({
      blockEngineUrl: 'https://bl.example/',
      retries: 0,
      authToken: 'secret-token',
      fetchImpl,
    });
    const id = await submitter.submitBundle([buildVersionedTx()]);
    expect(id).toBe('bundle-v0');
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((init!.headers as Record<string, string>)['x-jito-auth']).toBe('secret-token');
  });

  it('rejects construction without blockEngineUrl', () => {
    expect(() => new JitoBundleSubmitter({ blockEngineUrl: '' })).toThrow(/blockEngineUrl required/);
  });

  it('wraps fetch network error as JitoError network', async () => {
    const fetchImpl = fakeFetch(() => {
      throw new TypeError('connection refused');
    });
    const submitter = new JitoBundleSubmitter({
      blockEngineUrl: 'https://bl.example',
      retries: 0,
      fetchImpl,
    });
    await expect(submitter.submitBundle([buildTx()])).rejects.toMatchObject({
      name: 'JitoError',
      kind: 'network',
    });
  });

  it('wraps 500-class errors as JitoError server with response text', async () => {
    const fetchImpl = fakeFetch(() => new Response('internal-boom', { status: 503 }));
    const submitter = new JitoBundleSubmitter({
      blockEngineUrl: 'https://bl.example',
      retries: 0,
      fetchImpl,
    });
    await expect(submitter.submitBundle([buildTx()])).rejects.toMatchObject({
      kind: 'server',
      status: 503,
    });
  });

  it('wraps rpc-level body.error as JitoError rpc', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse({ jsonrpc: '2.0', id: 1, error: { message: 'sim failed' } }),
    );
    const submitter = new JitoBundleSubmitter({
      blockEngineUrl: 'https://bl.example',
      retries: 0,
      fetchImpl,
    });
    await expect(submitter.submitBundle([buildTx()])).rejects.toMatchObject({
      kind: 'rpc',
      message: 'sim failed',
    });
  });

  it('wraps rpc-level body.error with default message when missing', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ jsonrpc: '2.0', id: 1, error: {} }));
    const submitter = new JitoBundleSubmitter({
      blockEngineUrl: 'https://bl.example',
      retries: 0,
      fetchImpl,
    });
    await expect(submitter.submitBundle([buildTx()])).rejects.toThrow(/rpc error/);
  });

  it('falls back to empty string when response.text throws (safeText catch)', async () => {
    const brokenText = new Response(null, { status: 500 });
    Object.defineProperty(brokenText, 'text', {
      value: async () => {
        throw new Error('stream gone');
      },
    });
    const fetchImpl = fakeFetch(() => brokenText);
    const submitter = new JitoBundleSubmitter({
      blockEngineUrl: 'https://bl.example',
      retries: 0,
      fetchImpl,
    });
    await expect(submitter.submitBundle([buildTx()])).rejects.toMatchObject({
      kind: 'server',
      status: 500,
    });
  });

  it('parses Invalid status as Pending and unknown status as Unknown', async () => {
    const responses = [
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: { value: [{ bundle_id: 'b', status: 'Invalid' }] },
      }),
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: { value: [{ bundle_id: 'b', status: 'GibberishState' }] },
      }),
      jsonResponse({ jsonrpc: '2.0', id: 1, result: { value: [] } }),
    ];
    let idx = 0;
    const fetchImpl = fakeFetch(() => responses[idx++]!);
    const submitter = new JitoBundleSubmitter({
      blockEngineUrl: 'https://bl.example',
      retries: 0,
      fetchImpl,
    });
    expect(await submitter.getInflightBundleStatus('b')).toEqual({ state: 'Pending' });
    expect(await submitter.getInflightBundleStatus('b')).toEqual({ state: 'Unknown' });
    expect(await submitter.getInflightBundleStatus('b')).toEqual({ state: 'Unknown' });
  });

  it('fills missing slot/err.msg with defaults on Landed/Failed', async () => {
    const responses = [
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: { value: [{ bundle_id: 'b', status: 'Landed' }] },
      }),
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: { value: [{ bundle_id: 'b', status: 'Failed' }] },
      }),
    ];
    let idx = 0;
    const fetchImpl = fakeFetch(() => responses[idx++]!);
    const submitter = new JitoBundleSubmitter({
      blockEngineUrl: 'https://bl.example',
      retries: 0,
      fetchImpl,
    });
    expect(await submitter.getInflightBundleStatus('b')).toEqual({ state: 'Landed', slot: 0 });
    expect(await submitter.getInflightBundleStatus('b')).toEqual({
      state: 'Failed',
      reason: 'unknown',
    });
  });

  it('wraps non-JitoError thrown inside getInflightBundleStatus as JitoError network', async () => {
    const fetchImpl = fakeFetch(() => {
      throw new RangeError('dns fail');
    });
    const submitter = new JitoBundleSubmitter({
      blockEngineUrl: 'https://bl.example',
      retries: 0,
      fetchImpl,
    });
    await expect(submitter.getInflightBundleStatus('b')).rejects.toMatchObject({
      name: 'JitoError',
      kind: 'network',
    });
  });

  it('rethrows JitoError from inflight without rewrapping', async () => {
    const fetchImpl = fakeFetch(() => new Response('nope', { status: 400 }));
    const submitter = new JitoBundleSubmitter({
      blockEngineUrl: 'https://bl.example',
      retries: 0,
      fetchImpl,
    });
    await expect(submitter.getInflightBundleStatus('b')).rejects.toMatchObject({
      kind: 'client',
      status: 400,
    });
  });

  it('getTipAccounts maps result to { pubkey } and defaults to [] when null', async () => {
    const responses = [
      jsonResponse({ jsonrpc: '2.0', id: 1, result: ['tipA', 'tipB'] }),
      jsonResponse({ jsonrpc: '2.0', id: 1, result: null }),
    ];
    let idx = 0;
    const fetchImpl = fakeFetch(() => responses[idx++]!);
    const submitter = new JitoBundleSubmitter({
      blockEngineUrl: 'https://bl.example',
      retries: 0,
      fetchImpl,
    });
    expect(await submitter.getTipAccounts()).toEqual([{ pubkey: 'tipA' }, { pubkey: 'tipB' }]);
    expect(await submitter.getTipAccounts()).toEqual([]);
  });
});

describe('submitBundleOrFallback', () => {
  it('falls back to sendRaw when bundle fails and fallback allowed', async () => {
    const submitter = new JitoBundleSubmitter({
      blockEngineUrl: 'https://bl.example',
      retries: 0,
      fetchImpl: fakeFetch(() => new Response('down', { status: 503 })),
    });
    const sendRaw = vi.fn(async () => 'sig-fallback');
    const out = await submitBundleOrFallback(submitter, [buildTx()], {
      allowFallback: true,
      sendRaw,
    });
    expect(out.fallback).toBe(true);
    expect(out.signatures).toEqual(['sig-fallback']);
    expect(sendRaw).toHaveBeenCalledTimes(1);
  });

  it('rethrows when fallback disabled', async () => {
    const submitter = new JitoBundleSubmitter({
      blockEngineUrl: 'https://bl.example',
      retries: 0,
      fetchImpl: fakeFetch(() => new Response('down', { status: 503 })),
    });
    await expect(
      submitBundleOrFallback(submitter, [buildTx()], { allowFallback: false }),
    ).rejects.toBeInstanceOf(JitoError);
  });

  it('returns { bundleId, fallback: false } on success without invoking sendRaw', async () => {
    const submitter = new JitoBundleSubmitter({
      blockEngineUrl: 'https://bl.example',
      retries: 0,
      fetchImpl: fakeFetch(() =>
        jsonResponse({ jsonrpc: '2.0', id: 1, result: 'bundle-happy' }),
      ),
    });
    const sendRaw = vi.fn(async () => 'unused');
    const out = await submitBundleOrFallback(submitter, [buildTx()], {
      allowFallback: true,
      sendRaw,
    });
    expect(out).toEqual({ bundleId: 'bundle-happy', fallback: false });
    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('rethrows when allowFallback=true but sendRaw is absent', async () => {
    const submitter = new JitoBundleSubmitter({
      blockEngineUrl: 'https://bl.example',
      retries: 0,
      fetchImpl: fakeFetch(() => new Response('down', { status: 503 })),
    });
    await expect(
      submitBundleOrFallback(submitter, [buildTx()], { allowFallback: true }),
    ).rejects.toBeInstanceOf(JitoError);
  });

  it('serializes VersionedTransaction via .serialize() on the fallback path', async () => {
    const submitter = new JitoBundleSubmitter({
      blockEngineUrl: 'https://bl.example',
      retries: 0,
      fetchImpl: fakeFetch(() => new Response('down', { status: 503 })),
    });
    const sendRaw = vi.fn(async (raw: Uint8Array) => `sig-${raw.length}`);
    const vtx = buildVersionedTx();
    const out = await submitBundleOrFallback(submitter, [vtx], {
      allowFallback: true,
      sendRaw,
    });
    expect(out.fallback).toBe(true);
    expect(sendRaw).toHaveBeenCalledTimes(1);
    expect(out.signatures?.[0]).toMatch(/^sig-\d+$/);
  });
});
