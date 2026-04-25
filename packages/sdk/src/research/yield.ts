export type YieldVenue = 'kamino' | 'marginfi' | 'drift';

export type YieldLifecycle = 'live' | 'research' | 'next' | 'deferred';

export type YieldRiskTier = 'conservative' | 'moderate' | 'aggressive';

export type TreasuryYieldStatus = 'inactive' | 'active' | 'paused' | 'unwinding';

export interface YieldStrategyDescriptor {
  id: string;
  venue: YieldVenue;
  label: string;
  lifecycle: YieldLifecycle;
  riskTier: YieldRiskTier;
  summary: string;
  allowedMints: string[];
}

export interface TreasuryYieldPolicy {
  allowedStrategyIds: string[];
  maxAllocationBps: number;
  paused: boolean;
  emergencyUnwindEnabled: boolean;
}

export interface TreasuryYieldSnapshot {
  status: TreasuryYieldStatus;
  idleUsdMicro: bigint;
  deployedUsdMicro: bigint;
  realizedYieldUsdMicro: bigint;
  strategyId: string | null;
}

export const DEFAULT_YIELD_STRATEGIES: readonly YieldStrategyDescriptor[] = [
  {
    id: 'kamino-lend-usdc',
    venue: 'kamino',
    label: 'Kamino Lending',
    lifecycle: 'live',
    riskTier: 'conservative',
    summary:
      'Live first venue for idle treasury capital. Conservative lending only, with pause and unwind controls.',
    allowedMints: ['USDC'],
  },
  {
    id: 'marginfi-lend-usdc',
    venue: 'marginfi',
    label: 'Marginfi Lending',
    lifecycle: 'research',
    riskTier: 'moderate',
    summary:
      'Second venue after Kamino. Same constrained treasury posture, but only after the first live venue stabilizes.',
    allowedMints: ['USDC'],
  },
  {
    id: 'drift-yield-usdc',
    venue: 'drift',
    label: 'Drift Strategies',
    lifecycle: 'deferred',
    riskTier: 'aggressive',
    summary:
      'Later-tier venue for more stateful strategies. Explicitly deferred until lower-risk integrations are battle-tested.',
    allowedMints: ['USDC'],
  },
] as const;

export function getYieldStrategyDescriptor(
  strategyId: string,
  registry: readonly YieldStrategyDescriptor[] = DEFAULT_YIELD_STRATEGIES,
): YieldStrategyDescriptor | undefined {
  return registry.find((entry) => entry.id === strategyId);
}

export function validateTreasuryYieldPolicy(
  policy: TreasuryYieldPolicy,
  registry: readonly YieldStrategyDescriptor[] = DEFAULT_YIELD_STRATEGIES,
): string[] {
  const errors: string[] = [];
  if (policy.maxAllocationBps < 0 || policy.maxAllocationBps > 10_000) {
    errors.push('maxAllocationBps must be between 0 and 10_000');
  }
  if (policy.allowedStrategyIds.length === 0 && !policy.paused) {
    errors.push('active policies must allow at least one strategy');
  }
  for (const id of policy.allowedStrategyIds) {
    const strategy = getYieldStrategyDescriptor(id, registry);
    if (!strategy) {
      errors.push(`unknown strategy: ${id}`);
      continue;
    }
    if (strategy.lifecycle === 'deferred') {
      errors.push(`strategy is deferred and cannot be activated yet: ${id}`);
    }
  }
  if (!policy.emergencyUnwindEnabled) {
    errors.push('emergencyUnwindEnabled must remain true for constrained treasuries');
  }
  return errors;
}

export function computeDeployableUsdMicro(
  snapshot: TreasuryYieldSnapshot,
  policy: TreasuryYieldPolicy,
): bigint {
  if (snapshot.status === 'paused' || snapshot.status === 'unwinding' || policy.paused) {
    return 0n;
  }
  return (snapshot.idleUsdMicro * BigInt(policy.maxAllocationBps)) / 10_000n;
}
