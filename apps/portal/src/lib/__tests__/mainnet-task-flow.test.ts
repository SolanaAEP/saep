import { PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  MAINNET_SAEP_MINT,
  MAINNET_USDC_MINT,
  solanaExplorerTxUrl,
} from '@/lib/mainnet-status';
import {
  formatPaymentAmount,
  preferredPaymentMint,
  suggestedTinyAmount,
  toBaseUnits,
} from '@/lib/quick-hire';
import { resolvePublicServiceUpstreamPath } from '@/lib/service-proxy';

describe('mainnet task flow helpers', () => {
  it('does not append a devnet cluster param to mainnet explorer links', () => {
    expect(solanaExplorerTxUrl('abc123', 'mainnet-beta')).toBe(
      'https://explorer.solana.com/tx/abc123',
    );
    expect(solanaExplorerTxUrl('abc123', 'devnet')).toBe(
      'https://explorer.solana.com/tx/abc123?cluster=devnet',
    );
  });

  it('prefers USDC and keeps tiny public defaults for allowed mints', () => {
    const mints = [new PublicKey(MAINNET_SAEP_MINT), new PublicKey(MAINNET_USDC_MINT)];

    expect(preferredPaymentMint(mints)).toBe(MAINNET_USDC_MINT);
    expect(suggestedTinyAmount(MAINNET_USDC_MINT)).toBe('1');
    expect(suggestedTinyAmount(MAINNET_SAEP_MINT)).toBe('100');
  });

  it('formats USDC and SAEP decimal units for Quick Hire funding', () => {
    expect(toBaseUnits('1', 6)).toBe(1_000_000n);
    expect(toBaseUnits('100', 6)).toBe(100_000_000n);
    expect(() => toBaseUnits('1.0000001', 6)).toThrow('at most 6 decimals');
  });

  it('labels mainnet USDC and SAEP payments without SOL assumptions', () => {
    expect(formatPaymentAmount(1_000_000n, MAINNET_USDC_MINT)).toBe('1.00 USDC');
    expect(formatPaymentAmount('100000000', MAINNET_SAEP_MINT)).toBe('100.00 SAEP');
    expect(formatPaymentAmount('1000000', null)).toBe('1.00 tokens');
  });

  it('maps clean portal discovery task aliases to hosted indexer discovery routes', () => {
    expect(resolvePublicServiceUpstreamPath('discovery', ['tasks'])).toEqual([
      'v1',
      'discovery',
      'tasks',
    ]);
    expect(resolvePublicServiceUpstreamPath('discovery', ['tasks', 'a'.repeat(64)])).toEqual([
      'v1',
      'discovery',
      'tasks',
      'a'.repeat(64),
    ]);
    expect(resolvePublicServiceUpstreamPath('discovery', ['tasks', 'a'.repeat(64), 'bids'])).toEqual([
      'tasks',
      'a'.repeat(64),
      'bids',
    ]);
  });
});
