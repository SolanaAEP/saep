import { describe, expect, it, vi } from 'vitest';
import { Keypair, SystemProgram, Transaction } from '@solana/web3.js';
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
});
