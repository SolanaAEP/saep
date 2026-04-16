import { describe, expect, it, vi } from 'vitest';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  HeliusEstimateUnavailable,
  StakedRpcSubmitter,
  clampPriorityFee,
  getHeliusPriorityFeeEstimate,
  hasComputeBudgetIx,
  withPriorityFee,
} from '../staked.js';

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

function buildTransferTx(): Transaction {
  const from = Keypair.generate();
  const to = Keypair.generate();
  const tx = new Transaction();
  tx.add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to.publicKey,
      lamports: 1_000,
    }),
  );
  tx.recentBlockhash = '11111111111111111111111111111111';
  tx.feePayer = from.publicKey;
  return tx;
}

describe('withPriorityFee', () => {
  it('prepends both setComputeUnitLimit and setComputeUnitPrice when absent', () => {
    const tx = buildTransferTx();
    expect(tx.instructions).toHaveLength(1);
    withPriorityFee(tx, 5_000, 200_000);
    expect(tx.instructions).toHaveLength(3);
    expect(tx.instructions[0].programId.toBase58()).toBe(ComputeBudgetProgram.programId.toBase58());
    expect(tx.instructions[1].programId.toBase58()).toBe(ComputeBudgetProgram.programId.toBase58());
    const present = hasComputeBudgetIx(tx);
    expect(present).toEqual({ price: true, limit: true });
  });

  it('skips price ix when microLamports is 0', () => {
    const tx = buildTransferTx();
    withPriorityFee(tx, 0, 100_000);
    expect(hasComputeBudgetIx(tx)).toEqual({ price: false, limit: true });
  });

  it('is a no-op when no fee, no limit', () => {
    const tx = buildTransferTx();
    const before = tx.instructions.length;
    withPriorityFee(tx, 0);
    expect(tx.instructions).toHaveLength(before);
  });

  it('does not duplicate an existing setComputeUnitPrice', () => {
    const tx = buildTransferTx();
    tx.instructions = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000n }),
      ...tx.instructions,
    ];
    withPriorityFee(tx, 9_999);
    const cbIxs = tx.instructions.filter((ix) =>
      ix.programId.equals(ComputeBudgetProgram.programId),
    );
    expect(cbIxs).toHaveLength(1);
    expect(hasComputeBudgetIx(tx)).toEqual({ price: true, limit: false });
  });
});

describe('clampPriorityFee', () => {
  it('rounds up and applies floor', () => {
    expect(clampPriorityFee(123.4, { floor: 500 })).toBe(500);
  });
  it('caps at ceiling', () => {
    expect(clampPriorityFee(1_000_000, { cap: 50_000 })).toBe(50_000);
  });
  it('floors negative to zero', () => {
    expect(clampPriorityFee(-50, {})).toBe(0);
  });
});

describe('getHeliusPriorityFeeEstimate', () => {
  it('returns rounded micro-lamports on success', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse({ jsonrpc: '2.0', id: 'priority-fee', result: { priorityFeeEstimate: 1234.7 } }),
    );
    const tx = buildTransferTx();
    const est = await getHeliusPriorityFeeEstimate(
      'https://staked.helius-rpc.com/?api-key=k',
      tx.serialize({ verifySignatures: false }),
      'High',
      fetchImpl,
    );
    expect(est).toEqual({ microLamports: 1235, level: 'High' });
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(call[1]!.body as string);
    expect(body.method).toBe('getPriorityFeeEstimate');
    expect(body.params[0].options.priorityLevel).toBe('High');
    expect(body.params[0].options.transactionEncoding).toBe('base64');
  });

  it('throws HeliusEstimateUnavailable on rpc error', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse({ jsonrpc: '2.0', id: 'priority-fee', error: { message: 'unsupported' } }),
    );
    await expect(
      getHeliusPriorityFeeEstimate('https://x', new Uint8Array([1, 2, 3]), 'Medium', fetchImpl),
    ).rejects.toBeInstanceOf(HeliusEstimateUnavailable);
  });

  it('throws on non-2xx', async () => {
    const fetchImpl = fakeFetch(() => new Response('forbidden', { status: 403 }));
    await expect(
      getHeliusPriorityFeeEstimate('https://x', new Uint8Array([1]), 'Medium', fetchImpl),
    ).rejects.toThrow(/http 403/);
  });
});

describe('StakedRpcSubmitter', () => {
  it('posts sendTransaction to staked url and returns signature', async () => {
    const sig = '5'.repeat(88);
    const fetchImpl = fakeFetch(() => jsonResponse({ jsonrpc: '2.0', id: 'staked-send', result: sig }));
    const submitter = new StakedRpcSubmitter({
      stakedUrl: 'https://staked.helius-rpc.com/?api-key=k',
      retries: 0,
      fetchImpl,
    });
    const tx = buildTransferTx();
    const result = await submitter.submit(tx);
    expect(result).toBe(sig);
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(call[1]!.body as string);
    expect(body.method).toBe('sendTransaction');
    expect(body.params[1].encoding).toBe('base64');
    expect(body.params[1].skipPreflight).toBe(true);
    expect(typeof body.params[0]).toBe('string');
  });

  it('retries then falls back to fallback connection', async () => {
    const fetchImpl = fakeFetch(() => new Response('boom', { status: 500 }));
    const fakeConn = {
      sendRawTransaction: vi.fn(async () => 'fallback-sig'),
    } as unknown as Connection;
    const submitter = new StakedRpcSubmitter({
      stakedUrl: 'https://staked.example',
      retries: 2,
      fallbackConnection: fakeConn,
      fetchImpl,
    });
    const sig = await submitter.submit(buildTransferTx());
    expect(sig).toBe('fallback-sig');
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
    expect((fakeConn.sendRawTransaction as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('throws after retries when no fallback configured', async () => {
    const fetchImpl = fakeFetch(() => new Response('boom', { status: 502 }));
    const submitter = new StakedRpcSubmitter({
      stakedUrl: 'https://staked.example',
      retries: 1,
      fetchImpl,
    });
    await expect(submitter.submit(buildTransferTx())).rejects.toThrow(/502/);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it('rejects rpc-level error body', async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse({ jsonrpc: '2.0', id: 'staked-send', error: { message: 'simulation failed' } }),
    );
    const submitter = new StakedRpcSubmitter({
      stakedUrl: 'https://staked.example',
      retries: 0,
      fetchImpl,
    });
    await expect(submitter.submit(buildTransferTx())).rejects.toThrow(/simulation failed/);
  });

  it('honors per-call retries override and skipPreflight=false', async () => {
    let calls = 0;
    const fetchImpl = fakeFetch(() => {
      calls++;
      if (calls < 2) return new Response('boom', { status: 500 });
      return jsonResponse({ jsonrpc: '2.0', id: 'staked-send', result: 'sig-ok' });
    });
    const submitter = new StakedRpcSubmitter({
      stakedUrl: 'https://staked.example',
      retries: 0,
      fetchImpl,
    });
    const sig = await submitter.submit(buildTransferTx(), { retries: 2, skipPreflight: false });
    expect(sig).toBe('sig-ok');
    const second = JSON.parse(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[1]![1]!.body as string,
    );
    expect(second.params[1].skipPreflight).toBe(false);
  });

  it('rejects construction without stakedUrl', () => {
    expect(() => new StakedRpcSubmitter({ stakedUrl: '' })).toThrow();
  });

  it('uses pubkey-typed sender (sanity that PublicKey serialization survives)', () => {
    const pk = new PublicKey('11111111111111111111111111111112');
    expect(pk.toBase58()).toMatch(/^1+/);
  });
});
