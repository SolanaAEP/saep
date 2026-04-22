import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CIRCUIT_CATALOG,
  DEFAULT_YIELD_STRATEGIES,
  canonicalComputeBondAttestation,
  chainIdToSupportedIntentChain,
  circuitArtifactStem,
  circuitManifestPath,
  circuitRuntimeId,
  circuitRuntimeStem,
  transitionComputeBond,
  computeDeployableUsdMicro,
  deriveCrossChainState,
  getYieldStrategyDescriptor,
  validateComputeBondAttestation,
  validateCircuitCatalogEntry,
  validateComputeBondRecord,
  validateComputeBondTransition,
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

  it('validates and transitions compute bonds through the single-bind lifecycle', () => {
    const base = {
      agent_did: '11111111111111111111111111111111',
      provider: 'ionet' as const,
      lease_id: 'lease-1',
      gpu_hours: 4,
      expires_at: 2_000,
      attestation_sig: 'sig',
      broker_pubkey: 'pub',
      reserved_price_usd_micro: 50_000_000,
      slashable_until: 3_000,
      task_id: null,
      status: 'reserved' as const,
      created_at_ms: 1_000,
      updated_at_ms: 1_000,
      status_reason: null,
    };
    expect(validateComputeBondRecord(base)).toEqual([]);

    const locked = transitionComputeBond(base, {
      type: 'lock',
      task_id: 'task-123',
      now_ms: 1_500,
    });
    expect(locked.status).toBe('locked');
    expect(locked.task_id).toBe('task-123');

    const released = transitionComputeBond(locked, {
      type: 'release',
      task_id: 'task-123',
      now_ms: 1_700,
    });
    expect(released.status).toBe('released');
  });

  it('validates compute-bond attestation payloads and terminal edge cases', () => {
    expect(
      new TextDecoder().decode(
        canonicalComputeBondAttestation({
          agent_did: '11111111111111111111111111111111',
          provider: 'akash',
          lease_id: 'lease-2',
          gpu_hours: 8,
          expires_at: 5_000,
        }),
      ),
    ).toContain('"provider":"akash"');

    expect(
      validateComputeBondAttestation({
        agent_did: 'short',
        provider: 'ionet',
        lease_id: '',
        gpu_hours: 0,
        expires_at: 0,
      }),
    ).toEqual([
      'agent_did is too short',
      'lease_id is required',
      'gpu_hours must be a positive integer',
      'expires_at must be a positive integer',
    ]);

    expect(
      validateComputeBondRecord({
        agent_did: '11111111111111111111111111111111',
        provider: 'ionet',
        lease_id: 'lease-3',
        gpu_hours: 4,
        expires_at: 4_000,
        attestation_sig: 'sig',
        broker_pubkey: 'pub',
        reserved_price_usd_micro: -1,
        slashable_until: 3_000,
        task_id: '',
        status: 'expired',
        created_at_ms: 0,
        updated_at_ms: -1,
        status_reason: null,
      }),
    ).toEqual([
      'reserved_price_usd_micro must be non-negative',
      'slashable_until must be >= expires_at',
      'created_at_ms must be a positive integer',
      'updated_at_ms must be >= created_at_ms',
      'task_id cannot be empty',
    ]);
  });

  it('rejects invalid compute-bond transitions and covers terminal transitions', () => {
    const record = {
      agent_did: '11111111111111111111111111111111',
      provider: 'ionet' as const,
      lease_id: 'lease-4',
      gpu_hours: 4,
      expires_at: 2_000,
      attestation_sig: 'sig',
      broker_pubkey: 'pub',
      reserved_price_usd_micro: 50_000_000,
      slashable_until: 3_000,
      task_id: null,
      status: 'reserved' as const,
      created_at_ms: 1_000,
      updated_at_ms: 1_000,
      status_reason: null,
    };

    expect(
      validateComputeBondTransition(
        { ...record, status: 'locked', task_id: 'task-a' },
        { type: 'lock', task_id: 'task-b', now_ms: 1_100 },
      ),
    ).toEqual([
      'bond cannot lock from status locked',
      'bond is already bound to another task',
    ]);

    expect(
      validateComputeBondTransition(record, { type: 'expire', now_ms: 2_500_000 }),
    ).toEqual(['slashable window is still active']);

    expect(
      transitionComputeBond(
        { ...record, status: 'locked', task_id: 'task-c', updated_at_ms: 1_500 },
        { type: 'slash', task_id: 'task-c', now_ms: 2_500, reason: undefined },
      ),
    ).toMatchObject({
      status: 'slashed',
      status_reason: 'task slashed',
    });

    expect(
      transitionComputeBond(record, { type: 'cancel', now_ms: 1_200 }),
    ).toMatchObject({
      status: 'cancelled',
      status_reason: 'agent cancelled reservation',
    });

    expect(
      transitionComputeBond(
        { ...record, slashable_until: 1, updated_at_ms: 1_500 },
        { type: 'expire', now_ms: 2_000 },
      ),
    ).toMatchObject({
      status: 'expired',
      status_reason: 'slashable window elapsed',
    });
  });

  it('covers chain mapping and the full cross-chain state machine', () => {
    expect(chainIdToSupportedIntentChain(1)).toBe('solana');
    expect(chainIdToSupportedIntentChain(2)).toBe('ethereum');
    expect(chainIdToSupportedIntentChain(4)).toBe('bsc');
    expect(chainIdToSupportedIntentChain(999)).toBeNull();

    expect(deriveCrossChainState({ nowMs: 0, timeoutAtMs: 10_000 })).toBe('awaiting_funds');
    expect(deriveCrossChainState({ nowMs: 100, timeoutAtMs: 10_000 })).toBe('attesting');
    expect(deriveCrossChainState({ nowMs: 100, timeoutAtMs: 10_000, taskFunded: true })).toBe('task_funded');
    expect(deriveCrossChainState({ nowMs: 100, timeoutAtMs: 10_000, refunded: true })).toBe('refunded');
    expect(deriveCrossChainState({ nowMs: 100, timeoutAtMs: 10_000, settled: true })).toBe('settled');
    expect(deriveCrossChainState({ nowMs: 100, timeoutAtMs: 10_000, failed: true })).toBe('failed');
  });

  it('covers yield and ZK helper branches', () => {
    expect(getYieldStrategyDescriptor('kamino-lend-usdc')?.venue).toBe('kamino');
    expect(getYieldStrategyDescriptor('missing-strategy')).toBeUndefined();

    expect(
      validateTreasuryYieldPolicy({
        allowedStrategyIds: ['missing-strategy'],
        maxAllocationBps: 20_000,
        paused: false,
        emergencyUnwindEnabled: false,
      }),
    ).toEqual([
      'maxAllocationBps must be between 0 and 10_000',
      'unknown strategy: missing-strategy',
      'emergencyUnwindEnabled must remain true for constrained treasuries',
    ]);

    expect(
      computeDeployableUsdMicro(
        {
          status: 'paused',
          idleUsdMicro: 1_000_000n,
          deployedUsdMicro: 0n,
          realizedYieldUsdMicro: 0n,
          strategyId: null,
        },
        {
          allowedStrategyIds: [DEFAULT_YIELD_STRATEGIES[0]!.id],
          maxAllocationBps: 5_000,
          paused: false,
          emergencyUnwindEnabled: true,
        },
      ),
    ).toBe(0n);

    expect(circuitManifestPath(DEFAULT_CIRCUIT_CATALOG[1]!)).toBe('circuits/catalog/unique-execution-v1.json');
    expect(circuitRuntimeStem(DEFAULT_CIRCUIT_CATALOG[2]!)).toBe('task_output_hash');
    expect(
      validateCircuitCatalogEntry({
        slug: 'Bad Slug',
        displayName: 'Broken',
        lifecycle: 'planned',
        version: 0,
        verifier: 'groth16-bn254',
        verificationKeyVersion: 0,
        publicInputs: ['task_id', 'task_id'],
        summary: 'broken',
      }),
    ).toEqual([
      'version must be >= 1',
      'verificationKeyVersion must be >= 1',
      'publicInputs must be unique',
      'slug must contain only lowercase letters, numbers, and dashes',
    ]);
  });
});
