import { describe, expect, it } from 'vitest';
import {
  hexToBytes,
  bytesToHex,
  amountLe,
  commitHash,
  capabilityMaskFrom,
  randomNonce,
  randomAgentId,
} from '../crypto.js';

describe('crypto utilities', () => {
  it('hexToBytes converts 64-char hex to 32 bytes', () => {
    const hex = 'aa'.repeat(32);
    const bytes = hexToBytes(hex);
    expect(bytes.length).toBe(32);
    expect(bytes[0]).toBe(0xaa);
  });

  it('hexToBytes strips 0x prefix', () => {
    const hex = '0x' + '01'.repeat(32);
    const bytes = hexToBytes(hex);
    expect(bytes[0]).toBe(1);
  });

  it('hexToBytes rejects wrong length', () => {
    expect(() => hexToBytes('aa')).toThrow('expected 32-byte hex');
    expect(() => hexToBytes('aa'.repeat(16))).toThrow();
  });

  it('bytesToHex roundtrips', () => {
    const original = 'ab'.repeat(32);
    expect(bytesToHex(hexToBytes(original))).toBe(original);
  });

  it('bytesToHex handles number arrays', () => {
    expect(bytesToHex([0, 1, 255])).toBe('0001ff');
  });

  it('amountLe encodes little-endian', () => {
    const le = amountLe(256n);
    expect(le[0]).toBe(0);
    expect(le[1]).toBe(1);
    for (let i = 2; i < 8; i++) expect(le[i]).toBe(0);
  });

  it('amountLe encodes zero', () => {
    const le = amountLe(0n);
    expect(le.every((b) => b === 0)).toBe(true);
  });

  it('commitHash is deterministic', () => {
    const amount = 1_000_000n;
    const nonce = hexToBytes('bb'.repeat(32));
    const did = hexToBytes('cc'.repeat(32));
    const h1 = commitHash(amount, nonce, did);
    const h2 = commitHash(amount, nonce, did);
    expect(bytesToHex(h1)).toBe(bytesToHex(h2));
  });

  it('commitHash changes with different nonce', () => {
    const amount = 1_000_000n;
    const did = hexToBytes('cc'.repeat(32));
    const h1 = commitHash(amount, hexToBytes('aa'.repeat(32)), did);
    const h2 = commitHash(amount, hexToBytes('bb'.repeat(32)), did);
    expect(bytesToHex(h1)).not.toBe(bytesToHex(h2));
  });

  it('capabilityMaskFrom builds correct bitmask', () => {
    expect(capabilityMaskFrom([0])).toBe(1n);
    expect(capabilityMaskFrom([0, 1])).toBe(3n);
    expect(capabilityMaskFrom([2])).toBe(4n);
    expect(capabilityMaskFrom([0, 7])).toBe(129n);
  });

  it('capabilityMaskFrom handles empty array', () => {
    expect(capabilityMaskFrom([])).toBe(0n);
  });

  it('randomNonce produces 32 bytes', () => {
    const n = randomNonce();
    expect(n.length).toBe(32);
  });

  it('randomNonce produces unique values', () => {
    const a = bytesToHex(randomNonce());
    const b = bytesToHex(randomNonce());
    expect(a).not.toBe(b);
  });

  it('randomAgentId produces 32 bytes', () => {
    expect(randomAgentId().length).toBe(32);
  });

  it('no Math.random usage in crypto module', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../crypto.ts', import.meta.url).pathname, 'utf8');
    expect(src).not.toContain('Math.random');
  });
});
