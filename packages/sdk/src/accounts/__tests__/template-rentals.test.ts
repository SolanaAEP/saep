import { describe, expect, it, vi } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { fetchTemplateRentalsByRenter } from '../index.js';

describe('fetchTemplateRentalsByRenter', () => {
  it('queries TemplateRental accounts by renter offset', async () => {
    const renter = PublicKey.unique();
    const all = vi.fn().mockResolvedValue([]);
    const program = {
      account: {
        templateRental: { all },
      },
    } as any;

    await expect(fetchTemplateRentalsByRenter(program, renter)).resolves.toEqual([]);

    expect(all).toHaveBeenCalledWith([
      { memcmp: { offset: 8 + 32, bytes: renter.toBase58() } },
    ]);
  });
});
