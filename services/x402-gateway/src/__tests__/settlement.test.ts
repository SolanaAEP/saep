import { describe, expect, it } from 'vitest';
import {
  parseXPaymentHeader,
  requestHash,
  settleViaTaskMarket,
} from '../settlement.js';

describe('settlement', () => {
  it('parseXPaymentHeader returns null on garbage', () => {
    expect(parseXPaymentHeader('not json')).toBeNull();
  });

  it('parseXPaymentHeader parses valid JSON', () => {
    const p = parseXPaymentHeader(
      JSON.stringify({ scheme: 'exact', amount: 100, mint: 'abc', recipient: 'def', resource: '/x' }),
    );
    expect(p).toMatchObject({ scheme: 'exact', amount: 100 });
  });

  it('requestHash is deterministic', () => {
    const a = requestHash('POST', 'https://x.com/api', '{"foo":1}');
    const b = requestHash('POST', 'https://x.com/api', '{"foo":1}');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('requestHash changes with method', () => {
    const a = requestHash('GET', 'https://x.com/api');
    const b = requestHash('POST', 'https://x.com/api');
    expect(a).not.toBe(b);
  });

  it('rejects payment exceeding budget', async () => {
    await expect(
      settleViaTaskMarket(
        'http://localhost:8899',
        'localnet',
        { scheme: 'exact', amount: 5000, mint: 'x', recipient: 'y', resource: '/' },
        'aa'.repeat(32),
        'bb'.repeat(32),
        1000,
      ),
    ).rejects.toThrow('exceeds budget');
  });

  it('localnet settlement returns pseudo-sig without GATEWAY_KEYPAIR', async () => {
    const result = await settleViaTaskMarket(
      'http://localhost:8899',
      'localnet',
      { scheme: 'exact', amount: 100, mint: 'x', recipient: 'y', resource: '/' },
      'aa'.repeat(32),
      'bb'.repeat(32),
      1000,
    );
    expect(result.amount).toBe(100);
    expect(result.mint).toBe('x');
    expect(typeof result.tx_sig).toBe('string');
  });

  it('mainnet-beta settlement throws not-yet-wired', async () => {
    await expect(
      settleViaTaskMarket(
        'http://localhost:8899',
        'mainnet-beta',
        { scheme: 'exact', amount: 100, mint: 'x', recipient: 'y', resource: '/' },
        'aa'.repeat(32),
        'bb'.repeat(32),
        1000,
      ),
    ).rejects.toThrow('Jito bundle');
  });
});
