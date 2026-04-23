export type TemplateSimulationRecommendation = 'rent' | 'fork' | 'wait';

export interface TemplateSimulationInput {
  tasksPerMonth: number;
  avgRewardLamports: bigint | number | string;
  successRateBps: number;
  disputeRateBps: number;
  royaltyBps: number;
  platformFeeBps: number;
  rentPricePerSecLamports: bigint | number | string;
  rentDurationDays: number;
  forkSetupLamports?: bigint | number | string;
}

export interface TemplateSimulationResult {
  tasksPerMonth: number;
  expectedSuccessfulTasks: number;
  expectedDisputedTasks: number;
  grossRevenueLamports: string;
  royaltyCostLamports: string;
  rentCostLamports: string;
  platformFeeLamports: string;
  disputeLossLamports: string;
  rentNetLamports: string;
  forkNetLamports: string;
  bestNetLamports: string;
  authorRevenueLamports: string;
  breakEvenTasks: number | null;
  marginBps: number;
  recommendation: TemplateSimulationRecommendation;
}

function toBigInt(value: bigint | number | string | undefined, fallback = 0n): bigint {
  if (value == null || value === '') return fallback;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fallback;
    return BigInt(Math.max(0, Math.floor(value)));
  }
  try {
    return BigInt(value);
  } catch {
    return fallback;
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function bpsMul(value: bigint, bps: number): bigint {
  return (value * BigInt(clampInt(bps, 0, 10_000))) / 10_000n;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) return 0n;
  return (numerator + denominator - 1n) / denominator;
}

export function simulateTemplateEconomics(input: TemplateSimulationInput): TemplateSimulationResult {
  const tasksPerMonth = clampInt(input.tasksPerMonth, 0, 1_000_000);
  const avgRewardLamports = toBigInt(input.avgRewardLamports);
  const rentPricePerSecLamports = toBigInt(input.rentPricePerSecLamports);
  const forkSetupLamports = toBigInt(input.forkSetupLamports);
  const successRateBps = clampInt(input.successRateBps, 0, 10_000);
  const disputeRateBps = clampInt(input.disputeRateBps, 0, 10_000);
  const royaltyBps = clampInt(input.royaltyBps, 0, 10_000);
  const platformFeeBps = clampInt(input.platformFeeBps, 0, 10_000);
  const rentDurationDays = clampInt(input.rentDurationDays, 0, 3650);

  const taskCount = BigInt(tasksPerMonth);
  const expectedGrossBeforeSuccess = avgRewardLamports * taskCount;
  const grossRevenue = bpsMul(expectedGrossBeforeSuccess, successRateBps);
  const disputeLoss = bpsMul(expectedGrossBeforeSuccess, disputeRateBps);
  const royaltyCost = bpsMul(grossRevenue, royaltyBps);
  const rentCost = rentPricePerSecLamports * BigInt(rentDurationDays) * 86_400n;
  const platformFee = bpsMul(rentCost, platformFeeBps);
  const rentNet = grossRevenue - royaltyCost - rentCost - platformFee - disputeLoss;
  const forkNet = grossRevenue - royaltyCost - forkSetupLamports - disputeLoss;
  const bestNet = rentNet >= forkNet ? rentNet : forkNet;

  const perTaskExpectedGross = bpsMul(avgRewardLamports, successRateBps);
  const perTaskRoyalty = bpsMul(perTaskExpectedGross, royaltyBps);
  const perTaskDisputeLoss = bpsMul(avgRewardLamports, disputeRateBps);
  const perTaskContribution = perTaskExpectedGross - perTaskRoyalty - perTaskDisputeLoss;
  const fixedRentCost = rentCost + platformFee;
  const breakEvenTasks =
    fixedRentCost > 0n && perTaskContribution > 0n
      ? Number(ceilDiv(fixedRentCost, perTaskContribution))
      : null;
  const marginBps =
    grossRevenue > 0n ? Number((bestNet * 10_000n) / grossRevenue) : bestNet >= 0n ? 0 : -10_000;
  const recommendation: TemplateSimulationRecommendation =
    bestNet <= 0n ? 'wait' : rentNet >= forkNet ? 'rent' : 'fork';

  return {
    tasksPerMonth,
    expectedSuccessfulTasks: (tasksPerMonth * successRateBps) / 10_000,
    expectedDisputedTasks: (tasksPerMonth * disputeRateBps) / 10_000,
    grossRevenueLamports: grossRevenue.toString(),
    royaltyCostLamports: royaltyCost.toString(),
    rentCostLamports: rentCost.toString(),
    platformFeeLamports: platformFee.toString(),
    disputeLossLamports: disputeLoss.toString(),
    rentNetLamports: rentNet.toString(),
    forkNetLamports: forkNet.toString(),
    bestNetLamports: bestNet.toString(),
    authorRevenueLamports: (royaltyCost + rentCost).toString(),
    breakEvenTasks,
    marginBps,
    recommendation,
  };
}
