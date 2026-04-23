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
});
