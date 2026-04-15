import { describe, expect, it } from 'vitest';
import { getPublicKeyAsync, signAsync, hashes } from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import bs58 from 'bs58';
import { canonicalizeProxy, verifyProxyRequest } from '../auth.js';

hashes.sha512 = sha512;

describe('auth', () => {
  it('accepts valid signature', async () => {
    const sk = new Uint8Array(32).fill(7);
    const pk = await getPublicKeyAsync(sk);
    const body = {
      target_url: 'https://api.saep.example/x',
      method: 'POST',
      budget_lamports: 1000,
      mint: 'USDC',
      nonce: 'n1',
    };
    const canonical = canonicalizeProxy(body);
    const sig = await signAsync(new TextEncoder().encode(canonical), sk);
    const ok = await verifyProxyRequest(canonical, bs58.encode(sig), bs58.encode(pk));
    expect(ok).toBe(true);
  });

  it('rejects tampered canonical body', async () => {
    const sk = new Uint8Array(32).fill(7);
    const pk = await getPublicKeyAsync(sk);
    const sig = await signAsync(new TextEncoder().encode('orig'), sk);
    const ok = await verifyProxyRequest('tampered', bs58.encode(sig), bs58.encode(pk));
    expect(ok).toBe(false);
  });

  it('returns false on garbage signature', async () => {
    const pk = await getPublicKeyAsync(new Uint8Array(32).fill(1));
    const ok = await verifyProxyRequest('x', 'not-bs58!!!', bs58.encode(pk));
    expect(ok).toBe(false);
  });
});
