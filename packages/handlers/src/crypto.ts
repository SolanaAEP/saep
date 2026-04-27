import { keccak_256 } from '@noble/hashes/sha3.js';

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length !== 64) throw new Error('expected 32-byte hex');
  return Uint8Array.from(clean.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}

export function bytesToHex(bytes: Uint8Array | number[]): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function amountLe(amount: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let n = amount;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

export function randomNonce(): Uint8Array {
  const out = new Uint8Array(32);
  crypto.getRandomValues(out);
  return out;
}

export function randomAgentId(): Uint8Array {
  const out = new Uint8Array(32);
  crypto.getRandomValues(out);
  return out;
}

export function commitHash(amount: bigint, nonce: Uint8Array, agentDid: Uint8Array): Uint8Array {
  const buf = new Uint8Array(8 + 32 + 32);
  buf.set(amountLe(amount), 0);
  buf.set(nonce, 8);
  buf.set(agentDid, 40);
  return keccak_256(buf);
}

export function capabilityMaskFrom(bits: number[]): bigint {
  return bits.reduce((m, b) => m | (1n << BigInt(b)), 0n);
}
