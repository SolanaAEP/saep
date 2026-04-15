import { describe, expect, it } from 'vitest';
import { signAsync, getPublicKeyAsync, hashes, utils } from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import bs58 from 'bs58';
import { canonicalizeAuth, verifyAuthToken, verifyEnvelopeSignature } from '../auth.js';
import { canonicalizeForSigning } from '../schema.js';

hashes.sha512 = sha512;

async function issueToken(exp: number): Promise<{ token: string; agent: string; sk: Uint8Array }> {
  const sk = utils.randomSecretKey();
  const pk = await getPublicKeyAsync(sk);
  const agent = bs58.encode(pk);
  const nonce = bs58.encode(utils.randomSecretKey().slice(0, 16));
  const payload = { agent, nonce, exp };
  const sigBytes = await signAsync(canonicalizeAuth(payload), sk);
  const sig = bs58.encode(sigBytes);
  return { token: JSON.stringify({ ...payload, sig }), agent, sk };
}

describe('verifyAuthToken', () => {
  it('accepts valid signed token', async () => {
    const { token, agent } = await issueToken(Date.now() + 30_000);
    const r = await verifyAuthToken(token);
    expect(r).not.toBeNull();
    expect(r!.agentPubkey).toBe(agent);
  });

  it('rejects expired token', async () => {
    const { token } = await issueToken(Date.now() - 1);
    expect(await verifyAuthToken(token)).toBeNull();
  });

  it('rejects token too far in future', async () => {
    const { token } = await issueToken(Date.now() + 60 * 60_000);
    expect(await verifyAuthToken(token)).toBeNull();
  });

  it('rejects tampered payload', async () => {
    const { token } = await issueToken(Date.now() + 30_000);
    const parsed = JSON.parse(token);
    parsed.agent = bs58.encode(new Uint8Array(32));
    expect(await verifyAuthToken(JSON.stringify(parsed))).toBeNull();
  });

  it('rejects malformed json', async () => {
    expect(await verifyAuthToken('not json')).toBeNull();
  });

  it('rejects missing fields', async () => {
    expect(await verifyAuthToken(JSON.stringify({ agent: 'x' }))).toBeNull();
  });
});

describe('verifyEnvelopeSignature', () => {
  it('round-trips', async () => {
    const sk = utils.randomSecretKey();
    const pk = await getPublicKeyAsync(sk);
    const agent = bs58.encode(pk);
    const env = {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      topic: `agent.${agent}.inbox`,
      from_agent: agent,
      to_agent: null,
      payload_cid: 'bafy',
      payload_digest: 'a'.repeat(64),
      signature: '',
      ts: Math.floor(Date.now() / 1000),
    };
    const canonical = canonicalizeForSigning(env as never);
    const sig = await signAsync(new TextEncoder().encode(canonical), sk);
    const sigB58 = bs58.encode(sig);
    expect(await verifyEnvelopeSignature(canonical, sigB58, agent)).toBe(true);
    expect(await verifyEnvelopeSignature(canonical + 'x', sigB58, agent)).toBe(false);
  });
});
