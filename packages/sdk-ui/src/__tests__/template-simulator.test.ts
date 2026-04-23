import { describe, expect, it } from 'vitest';
import { simulateTemplateEconomics } from '../template-simulator.js';

describe('simulateTemplateEconomics', () => {
  it('recommends renting when rental cost is below fork setup cost', () => {
    const result = simulateTemplateEconomics({
      tasksPerMonth: 50,
      avgRewardLamports: 1_000_000_000n,
      successRateBps: 9_000,
      disputeRateBps: 250,
      royaltyBps: 500,
      platformFeeBps: 200,
      rentPricePerSecLamports: 50n,
      rentDurationDays: 30,
      forkSetupLamports: 10_000_000_000n,
    });

    expect(result.grossRevenueLamports).toBe('45000000000');
    expect(result.royaltyCostLamports).toBe('2250000000');
    expect(result.rentCostLamports).toBe('129600000');
    expect(result.recommendation).toBe('rent');
    expect(result.breakEvenTasks).toBe(1);
  });

  it('recommends waiting when expected economics are negative', () => {
    const result = simulateTemplateEconomics({
      tasksPerMonth: 2,
      avgRewardLamports: 100_000n,
      successRateBps: 4_000,
      disputeRateBps: 2_000,
      royaltyBps: 1_000,
      platformFeeBps: 500,
      rentPricePerSecLamports: 10_000n,
      rentDurationDays: 14,
      forkSetupLamports: 50_000_000n,
    });

    expect(result.recommendation).toBe('wait');
    expect(BigInt(result.bestNetLamports)).toBeLessThanOrEqual(0n);
  });

  it('clamps invalid rates and task counts', () => {
    const result = simulateTemplateEconomics({
      tasksPerMonth: -10,
      avgRewardLamports: 'not-a-number',
      successRateBps: 20_000,
      disputeRateBps: -1,
      royaltyBps: 25_000,
      platformFeeBps: 0,
      rentPricePerSecLamports: 0,
      rentDurationDays: 0,
    });

    expect(result.tasksPerMonth).toBe(0);
    expect(result.grossRevenueLamports).toBe('0');
    expect(result.recommendation).toBe('wait');
  });

  it('recommends forking when setup beats rental cost', () => {
    const result = simulateTemplateEconomics({
      tasksPerMonth: 20,
      avgRewardLamports: '1000000000',
      successRateBps: 10_000,
      disputeRateBps: 0,
      royaltyBps: 0,
      platformFeeBps: 0,
      rentPricePerSecLamports: 10_000n,
      rentDurationDays: 30,
      forkSetupLamports: 1_000_000_000n,
    });

    expect(result.recommendation).toBe('fork');
    expect(BigInt(result.forkNetLamports)).toBeGreaterThan(BigInt(result.rentNetLamports));
  });

  it('returns no break-even point when contribution is non-positive', () => {
    const result = simulateTemplateEconomics({
      tasksPerMonth: 10,
      avgRewardLamports: 100_000n,
      successRateBps: 0,
      disputeRateBps: 10_000,
      royaltyBps: 0,
      platformFeeBps: 0,
      rentPricePerSecLamports: 10n,
      rentDurationDays: 1,
    });

    expect(result.breakEvenTasks).toBeNull();
    expect(result.marginBps).toBe(-10_000);
    expect(result.recommendation).toBe('wait');
  });

  it('floors finite number inputs before simulating', () => {
    const result = simulateTemplateEconomics({
      tasksPerMonth: 2.9,
      avgRewardLamports: 1_999.9,
      successRateBps: 10_000,
      disputeRateBps: 0,
      royaltyBps: 0,
      platformFeeBps: 0,
      rentPricePerSecLamports: 0,
      rentDurationDays: 0,
    });

    expect(result.tasksPerMonth).toBe(2);
    expect(result.grossRevenueLamports).toBe('3998');
    expect(result.breakEvenTasks).toBeNull();
    expect(result.recommendation).toBe('rent');
  });

  it('treats non-finite values and empty strings as zero', () => {
    const result = simulateTemplateEconomics({
      tasksPerMonth: Number.POSITIVE_INFINITY,
      avgRewardLamports: Number.NaN,
      successRateBps: Number.NEGATIVE_INFINITY,
      disputeRateBps: 0,
      royaltyBps: 0,
      platformFeeBps: 0,
      rentPricePerSecLamports: '',
      rentDurationDays: 0,
      forkSetupLamports: Number.NaN,
    });

    expect(result.tasksPerMonth).toBe(0);
    expect(result.grossRevenueLamports).toBe('0');
    expect(result.rentCostLamports).toBe('0');
    expect(result.marginBps).toBe(0);
  });
});
