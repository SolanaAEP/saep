import { describe, expect, it } from 'vitest';
import { SOLANA_DOMAIN, validateCctpTarget, waitForAttestation } from '../cctp.js';

describe('cctp', () => {
  it('rejects non-solana dest', () => {
    expect(() =>
      validateCctpTarget({
        sourceDomain: 0,
        destDomain: 3,
        amount: 1000n,
        recipient: 'r',
        nonce: 'n',
      }),
    ).toThrow(/dest domain/);
  });

  it('rejects zero amount', () => {
    expect(() =>
      validateCctpTarget({
        sourceDomain: 0,
        destDomain: SOLANA_DOMAIN,
        amount: 0n,
        recipient: 'r',
        nonce: 'n',
      }),
    ).toThrow(/positive/);
  });

  it('resolves on first attestation hit', async () => {
    const attestation = await waitForAttestation(
      'h',
      async () => ({ attestation: 'abcd' }),
      5_000,
    );
    expect(attestation).toBe('abcd');
  });

  it('throws on timeout', async () => {
    let now = 0;
    const clock = () => now;
    const sleep = async (ms: number) => {
      now += ms;
    };
    await expect(
      waitForAttestation('h', async () => null, 100, 10, clock, sleep),
    ).rejects.toThrow(/timeout/);
  });
});
