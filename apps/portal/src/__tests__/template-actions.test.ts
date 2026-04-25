import { describe, expect, it } from 'vitest';
import {
  bytesFromHex,
  formatBaseUnits,
  formatDurationShort,
  rentalClaimableAmount,
  rentalPrepaidAmount,
  rentalRemainingSeconds,
} from '@/lib/template-actions';

describe('template action helpers', () => {
  it('validates 32-byte hex values', () => {
    expect(bytesFromHex('aa'.repeat(32), 'did')).toHaveLength(32);
    expect(() => bytesFromHex('abc', 'did')).toThrow('did must be a 32-byte hex string');
  });

  it('computes prepaid rental cost', () => {
    expect(rentalPrepaidAmount('10', 60)).toBe(600n);
  });

  it('formats base units with decimals', () => {
    expect(formatBaseUnits(1_234_500n, 6, 'USDC')).toBe('1.2345 USDC');
    expect(formatBaseUnits(1_000_000n, 6, 'USDC')).toBe('1 USDC');
  });

  it('derives remaining and claimable rental amounts', () => {
    const rental = {
      startTime: 100,
      endTime: 200,
      dripRatePerSec: '5',
      claimedAuthor: '20',
      claimedPlatform: '10',
      status: 'active' as const,
    };
    expect(rentalRemainingSeconds(rental, 150)).toBe(50);
    expect(rentalClaimableAmount(rental, 150)).toBe(220n);
    expect(formatDurationShort(172_800)).toBe('2d');
  });
});
