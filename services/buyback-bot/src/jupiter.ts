import { z } from 'zod';

// Jupiter v6 quote response — minimal subset the bot relies on. The full
// schema is much larger; we validate only the fields required for our
// slippage gate and downstream metrics so a Jupiter side-additive change
// does not break the worker.
const QuoteResponseSchema = z.object({
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: z.string(),
  outAmount: z.string(),
  otherAmountThreshold: z.string(),
  swapMode: z.string(),
  slippageBps: z.number().int(),
  priceImpactPct: z.string(),
});

export type QuoteResponse = z.infer<typeof QuoteResponseSchema>;

export interface QuoteRequest {
  apiUrl: string;
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps: number;
  fetchImpl?: typeof fetch;
}

export async function getJupiterQuote(input: QuoteRequest): Promise<QuoteResponse> {
  const fetchFn = input.fetchImpl ?? globalThis.fetch;
  const url = new URL(`${input.apiUrl.replace(/\/$/, '')}/quote`);
  url.searchParams.set('inputMint', input.inputMint);
  url.searchParams.set('outputMint', input.outputMint);
  url.searchParams.set('amount', input.amount.toString());
  url.searchParams.set('slippageBps', input.slippageBps.toString());
  url.searchParams.set('swapMode', 'ExactIn');

  const res = await fetchFn(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`jupiter quote ${res.status}: ${body || res.statusText}`);
  }
  const json = await res.json();
  return QuoteResponseSchema.parse(json);
}

export function priceImpactPctToBps(pct: string): number {
  const parsed = Number(pct);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(Math.abs(parsed) * 10_000);
}

export function isWithinSlippageCap(quote: QuoteResponse, capBps: number): boolean {
  const impactBps = priceImpactPctToBps(quote.priceImpactPct);
  return impactBps <= capBps;
}

export interface SwapRequest {
  apiUrl: string;
  quoteResponse: QuoteResponse;
  userPublicKey: string;
  wrapAndUnwrapSol?: boolean;
  fetchImpl?: typeof fetch;
}

export interface SwapResponse {
  swapTransaction: string;
  lastValidBlockHeight: number;
}

const SwapResponseSchema = z.object({
  swapTransaction: z.string(),
  lastValidBlockHeight: z.number().int(),
});

export async function getJupiterSwap(input: SwapRequest): Promise<SwapResponse> {
  const fetchFn = input.fetchImpl ?? globalThis.fetch;
  const url = `${input.apiUrl.replace(/\/$/, '')}/swap`;

  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: input.quoteResponse,
      userPublicKey: input.userPublicKey,
      wrapAndUnwrapSol: input.wrapAndUnwrapSol ?? true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`jupiter swap ${res.status}: ${body || res.statusText}`);
  }
  const json = await res.json();
  return SwapResponseSchema.parse(json);
}
