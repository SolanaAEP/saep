import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@pythnetwork/price-service-client', () => {
  class MockPriceServiceConnection {
    async getLatestPriceFeeds(ids: string[]) {
      return ids.map((id) => {
        if (id.startsWith('ec5d')) {
          return {
            getPriceNoOlderThan: () => ({
              price: '55000000',
              expo: -8,
              conf: '100000',
              publishTime: Math.floor(Date.now() / 1000),
            }),
          };
        }
        return {
          getPriceNoOlderThan: () => ({
            price: '14000000000',
            expo: -8,
            conf: '5000000',
            publishTime: Math.floor(Date.now() / 1000),
          }),
        };
      });
    }
  }
  return { PriceServiceConnection: MockPriceServiceConnection };
});

import { convertXrpToLamports, getXrpToSolRate, _resetCache, initOracle } from '../price-oracle.js';

beforeEach(() => {
  _resetCache();
  initOracle('https://test.pyth.network');
});

describe('price-oracle', () => {
  it('derives XRP/SOL rate from XRP/USD and SOL/USD', async () => {
    const { rate, xrpUsd, solUsd } = await getXrpToSolRate();
    expect(xrpUsd).toBeCloseTo(0.55, 1);
    expect(solUsd).toBeCloseTo(140, 0);
    expect(rate).toBeCloseTo(0.55 / 140, 5);
  });

  it('converts XRP drops to lamports correctly', async () => {
    const lamports = await convertXrpToLamports(10_000_000n);
    const expected = BigInt(Math.floor((10 * 0.55 / 140) * 1_000_000_000));
    expect(lamports).toBe(expected);
  });

  it('handles 1 drop correctly', async () => {
    const lamports = await convertXrpToLamports(1n);
    expect(lamports).toBeGreaterThanOrEqual(0n);
  });

  it('handles large amounts without overflow', async () => {
    const lamports = await convertXrpToLamports(1_000_000_000_000_000n);
    expect(lamports).toBeGreaterThan(0n);
  });

  it('rate is XRP/SOL not SOL/XRP', async () => {
    const { rate } = await getXrpToSolRate();
    expect(rate).toBeLessThan(1);
    expect(rate).toBeGreaterThan(0);
  });
});
