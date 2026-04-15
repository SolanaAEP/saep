import { verifyAsync, hashes } from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import bs58 from 'bs58';

hashes.sha512 = sha512;

export async function verifyProxyRequest(
  canonicalBody: string,
  signatureBs58: string,
  agentDidBs58: string,
): Promise<boolean> {
  try {
    const sig = bs58.decode(signatureBs58);
    const pk = bs58.decode(agentDidBs58);
    if (sig.length !== 64 || pk.length !== 32) return false;
    return await verifyAsync(sig, new TextEncoder().encode(canonicalBody), pk);
  } catch {
    return false;
  }
}

export function canonicalizeProxy(body: {
  target_url: string;
  method: string;
  budget_lamports: number;
  mint: string;
  body_hash?: string;
  nonce: string;
}): string {
  const keys = ['target_url', 'method', 'budget_lamports', 'mint', 'body_hash', 'nonce'] as const;
  const out: Record<string, unknown> = {};
  for (const k of keys) if (body[k] !== undefined) out[k] = body[k];
  return JSON.stringify(out);
}
