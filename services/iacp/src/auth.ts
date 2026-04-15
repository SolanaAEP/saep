import { verifyAsync, hashes } from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import bs58 from 'bs58';

hashes.sha512 = sha512;

const TOKEN_TTL_MS = 2 * 60_000;

export interface AuthResult {
  agentPubkey: string;
}

export interface AuthToken {
  agent: string;
  nonce: string;
  exp: number;
  sig: string;
}

export function canonicalizeAuth(t: Omit<AuthToken, 'sig'>): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({ agent: t.agent, nonce: t.nonce, exp: t.exp }),
  );
}

export async function verifyAuthToken(
  token: string,
  now: number = Date.now(),
): Promise<AuthResult | null> {
  let parsed: AuthToken;
  try {
    parsed = JSON.parse(token) as AuthToken;
  } catch {
    return null;
  }
  if (
    typeof parsed.agent !== 'string' ||
    typeof parsed.nonce !== 'string' ||
    typeof parsed.exp !== 'number' ||
    typeof parsed.sig !== 'string'
  ) {
    return null;
  }
  if (parsed.exp < now) return null;
  if (parsed.exp > now + TOKEN_TTL_MS * 2) return null;
  if (parsed.nonce.length < 16 || parsed.nonce.length > 64) return null;

  let pubkey: Uint8Array;
  let sig: Uint8Array;
  try {
    pubkey = bs58.decode(parsed.agent);
    sig = bs58.decode(parsed.sig);
  } catch {
    return null;
  }
  if (pubkey.length !== 32 || sig.length !== 64) return null;

  const msg = canonicalizeAuth(parsed);
  try {
    const ok = await verifyAsync(sig, msg, pubkey);
    return ok ? { agentPubkey: parsed.agent } : null;
  } catch {
    return null;
  }
}

export async function verifyEnvelopeSignature(
  canonical: string,
  signatureBs58: string,
  agentPubkeyBs58: string,
): Promise<boolean> {
  let pubkey: Uint8Array;
  let sig: Uint8Array;
  try {
    pubkey = bs58.decode(agentPubkeyBs58);
    sig = bs58.decode(signatureBs58);
  } catch {
    return false;
  }
  if (pubkey.length !== 32 || sig.length !== 64) return false;
  const msg = new TextEncoder().encode(canonical);
  try {
    return await verifyAsync(sig, msg, pubkey);
  } catch {
    return false;
  }
}
