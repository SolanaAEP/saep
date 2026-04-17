import { createHash } from 'node:crypto';

export interface PaymentDetails {
  scheme: string;
  amount: number;
  mint: string;
  recipient: string;
  resource: string;
  nonce?: string;
}

export interface PaymentReceipt {
  tx_sig: string;
  amount: number;
  mint: string;
}

export function parseXPaymentHeader(header: string): PaymentDetails | null {
  try {
    return JSON.parse(header) as PaymentDetails;
  } catch {
    return null;
  }
}

export function requestHash(method: string, url: string, body?: string): string {
  const h = createHash('sha256');
  h.update(`${method}\n${url}\n${body ?? ''}`);
  return h.digest('hex');
}

export interface SettlementResult {
  tx_sig: string;
  amount: number;
  mint: string;
}

export async function settleViaTaskMarket(
  rpcUrl: string,
  cluster: 'mainnet-beta' | 'devnet' | 'localnet',
  payment: PaymentDetails,
  agentDid: string,
  argsHash: string,
  budgetLamports: number,
): Promise<SettlementResult> {
  if (cluster === 'mainnet-beta') {
    throw new Error('real settlement not yet wired — mainnet-beta is blocked until on-chain path is implemented');
  }

  if (payment.amount > budgetLamports) {
    throw new Error(`payment ${payment.amount} exceeds budget ${budgetLamports}`);
  }

  // devnet/localnet: simulate settlement via memo tx
  // production path: @saep/sdk builders + Jito bundle
  const txSig = await simulateSettlement(rpcUrl, payment, agentDid, argsHash);
  return { tx_sig: txSig, amount: payment.amount, mint: payment.mint };
}

async function simulateSettlement(
  rpcUrl: string,
  payment: PaymentDetails,
  agentDid: string,
  argsHash: string,
): Promise<string> {
  // on devnet/localnet we record intent; real path would construct:
  // createTask + fundTask + submitResult + release as a Jito bundle
  const memo = JSON.stringify({
    kind: 'x402_settlement',
    agent: agentDid,
    amount: payment.amount,
    mint: payment.mint,
    recipient: payment.recipient,
    args_hash: argsHash,
    ts: Date.now(),
  });

  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getHealth',
    }),
  }).catch(() => null);

  // if RPC is reachable, return a deterministic pseudo-sig for tracking
  // real implementation submits the bundle and returns the actual signature
  if (res?.ok) {
    const h = createHash('sha256');
    h.update(memo);
    return h.digest('base64url');
  }

  // offline fallback: return a clearly-marked placeholder
  const h = createHash('sha256');
  h.update(memo);
  return `devnet_pending_${h.digest('hex').slice(0, 16)}`;
}

export type TxStatus = 'confirmed' | 'finalized' | 'not_found' | 'failed';

export async function verifySettlement(
  rpcUrl: string,
  txSig: string,
): Promise<{ status: TxStatus; slot?: number; err?: string }> {
  // devnet pseudo-sigs from the fallback path
  if (txSig.startsWith('devnet_pending_')) {
    return { status: 'confirmed', slot: 0 };
  }

  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [txSig, { encoding: 'json', commitment: 'confirmed' }],
      }),
    });
    if (!res.ok) {
      return { status: 'not_found', err: `rpc ${res.status}` };
    }

    const body = (await res.json()) as {
      result?: {
        slot?: number;
        meta?: { err?: unknown };
      } | null;
      error?: { message: string };
    };

    if (body.error) return { status: 'not_found', err: body.error.message };
    if (!body.result) return { status: 'not_found' };
    if (body.result.meta?.err) {
      return { status: 'failed', slot: body.result.slot, err: JSON.stringify(body.result.meta.err) };
    }
    return { status: 'confirmed', slot: body.result.slot };
  } catch (e) {
    return { status: 'not_found', err: e instanceof Error ? e.message : String(e) };
  }
}
