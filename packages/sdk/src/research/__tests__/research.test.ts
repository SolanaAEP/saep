import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CIRCUIT_CATALOG,
  DEFAULT_YIELD_STRATEGIES,
  circuitArtifactStem,
  circuitRuntimeId,
  computeDeployableUsdMicro,
  deriveCrossChainState,
  validateCircuitCatalogEntry,
  validateCrossChainIntent,
  validateTreasuryYieldPolicy,
} from '../index.js';

describe('research surfaces', () => {
  it('validates treasury yield policies against deferred strategies', () => {
    const errors = validateTreasuryYieldPolicy({
      allowedStrategyIds: ['drift-yield-usdc'],
      maxAllocationBps: 5_000,
      paused: false,
      emergencyUnwindEnabled: true,
    });
    expect(errors).toContain('strategy is deferred and cannot be activated yet: drift-yield-usdc');
  });

  it('computes deployable capital only while active', () => {
    const deployable = computeDeployableUsdMicro(
      {
        status: 'active',
        idleUsdMicro: 900_000_000n,
        deployedUsdMicro: 100_000_000n,
        realizedYieldUsdMicro: 10_000_000n,
        strategyId: DEFAULT_YIELD_STRATEGIES[0]!.id,
      },
      {
        allowedStrategyIds: [DEFAULT_YIELD_STRATEGIES[0]!.id],
        maxAllocationBps: 2_500,
        paused: false,
        emergencyUnwindEnabled: true,
      },
    );
    expect(deployable).toBe(225_000_000n);
  });

  it('derives cross-chain lifecycle states deterministically', () => {
    expect(
      deriveCrossChainState({
        nowMs: 1_000,
        timeoutAtMs: 2_000,
        attested: true,
      }),
    ).toBe('ready_to_fund_task');
    expect(
      deriveCrossChainState({
        nowMs: 3_000,
        timeoutAtMs: 2_000,
      }),
    ).toBe('expired');
  });

  it('validates cross-chain intents against supported chains and timeout windows', () => {
    const errors = validateCrossChainIntent({
      intentId: 'intent-1',
      protocol: 'layerzero-intent',
      sourceChain: 'ethereum',
      destinationChain: 'solana',
      assetSymbol: 'USDC',
      amountAtomic: '2500000',
      beneficiaryDid: 'agent-did-1234567890',
      requester: '0xabc',
      createdAtMs: 1_000,
      timeoutAtMs: 500,
    });
    expect(errors).toContain('timeoutAtMs must be after createdAtMs');
  });

  it('builds circuit artifact stems and validates catalog entries', () => {
    const liveCircuit = DEFAULT_CIRCUIT_CATALOG[0]!;
    expect(circuitArtifactStem(liveCircuit)).toBe('task-completion-v1');
    expect(circuitRuntimeId(liveCircuit)).toBe('task_completion.v1');
    expect(validateCircuitCatalogEntry(liveCircuit)).toEqual([]);
  });
});
