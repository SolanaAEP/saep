import { verifyAsync, hashes } from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import bs58 from 'bs58';
import {
  sessionSecret,
  verifySessionJwt,
  type SessionPayload,
} from '@saep/sdk';

hashes.sha512 = sha512;

export interface AuthResult {
  agentPubkey: string;
  expiresAt: number;
}

export function loadSessionSecret(): Uint8Array {
  return sessionSecret(process.env.SESSION_SECRET);
}

export async function verifySessionToken(
  token: string,
  secret: Uint8Array,
  now: number = Date.now(),
): Promise<AuthResult | null> {
  const payload: SessionPayload | null = await verifySessionJwt(token, secret);
  if (!payload) return null;
  if (payload.expiresAt * 1000 < now) return null;
  try {
    const decoded = bs58.decode(payload.address);
    if (decoded.length !== 32) return null;
  } catch {
    return null;
  }
  return { agentPubkey: payload.address, expiresAt: payload.expiresAt };
}

export const DEFAULT_MAX_ENVELOPE_AGE_MS = 5 * 60 * 1000;
export const DEFAULT_ENVELOPE_CLOCK_SKEW_MS = 30 * 1000;

export interface FreshnessOptions {
  maxAgeMs?: number;
  maxSkewMs?: number;
}

export function isEnvelopeTsFresh(
  ts: number,
  now: number = Date.now(),
  opts: FreshnessOptions = {},
): boolean {
  if (!Number.isFinite(ts) || ts < 0) return false;
  const maxAge = opts.maxAgeMs ?? DEFAULT_MAX_ENVELOPE_AGE_MS;
  const maxSkew = opts.maxSkewMs ?? DEFAULT_ENVELOPE_CLOCK_SKEW_MS;
  const delta = ts - now;
  if (delta > maxSkew) return false;
  if (-delta > maxAge) return false;
  return true;
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
