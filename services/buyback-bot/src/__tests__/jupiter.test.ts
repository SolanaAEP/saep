import { describe, it, expect, vi } from 'vitest';
import { getJupiterQuote, isWithinSlippageCap, priceImpactPctToBps } from '../jupiter.js';

describe('priceImpactPctToBps', () => {
  it('rounds positive percentages to bps', () => {
    expect(priceImpactPctToBps('0.0123')).toBe(123);
    expect(priceImpactPctToBps('1.5')).toBe(15_000);
  });

  it('takes absolute value of negative impact', () => {
    expect(priceImpactPctToBps('-0.0042')).toBe(42);
  });

  it('returns 0 for non-numeric input', () => {
    expect(priceImpactPctToBps('not-a-number')).toBe(0);
    expect(priceImpactPctToBps('')).toBe(0);
  });
});

describe('isWithinSlippageCap', () => {
  const baseQuote = {
    inputMint: 'A',
    outputMint: 'B',
    inAmount: '1000',
    outAmount: '950',
    otherAmountThreshold: '900',
    swapMode: 'ExactIn',
    slippageBps: 200,
    priceImpactPct: '0',
  };

  it('passes when impact below cap', () => {
    expect(isWithinSlippageCap({ ...baseQuote, priceImpactPct: '0.01' }, 200)).toBe(true);
  });

  it('fails when impact equals cap exactly', () => {
    // 0.02 → 200 bps, cap 200 → boundary case is allowed (≤ cap)
    expect(isWithinSlippageCap({ ...baseQuote, priceImpactPct: '0.02' }, 200)).toBe(true);
  });

  it('fails when impact above cap', () => {
    expect(isWithinSlippageCap({ ...baseQuote, priceImpactPct: '0.03' }, 200)).toBe(false);
  });
});

describe('getJupiterQuote', () => {
  it('builds the v6 quote URL with all required params', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          inputMint: 'A',
          outputMint: 'B',
          inAmount: '1000',
          outAmount: '950',
          otherAmountThreshold: '900',
          swapMode: 'ExactIn',
          slippageBps: 200,
          priceImpactPct: '0.001',
        }),
        { status: 200 },
      ),
    );

    const out = await getJupiterQuote({
      apiUrl: 'https://quote-api.jup.ag/v6',
      inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      outputMint: 'HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump',
      amount: 1_000_000n,
      slippageBps: 200,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown as Array<[string, ...unknown[]]>;
    const call = calls[0]?.[0] ?? '';
    expect(call).toContain('quote');
    expect(call).toContain('inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(call).toContain('outputMint=HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump');
    expect(call).toContain('amount=1000000');
    expect(call).toContain('slippageBps=200');
    expect(call).toContain('swapMode=ExactIn');
    expect(out.outAmount).toBe('950');
  });

  it('throws on non-2xx response', async () => {
    const fetchMock = vi.fn(async () => new Response('rate limited', { status: 429 }));
    await expect(
      getJupiterQuote({
        apiUrl: 'https://quote-api.jup.ag/v6',
        inputMint: 'A',
        outputMint: 'B',
        amount: 1n,
        slippageBps: 200,
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/jupiter quote 429/);
  });

  it('rejects malformed responses (zod parse failure)', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ inputMint: 'A' /* missing required fields */ }), {
        status: 200,
      }),
    );
    await expect(
      getJupiterQuote({
        apiUrl: 'https://quote-api.jup.ag/v6',
        inputMint: 'A',
        outputMint: 'B',
        amount: 1n,
        slippageBps: 200,
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow();
  });
});
