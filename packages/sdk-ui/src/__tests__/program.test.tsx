import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as sdk from '@saep/sdk';
import {
  useProgram,
  useAgentRegistryProgram,
  useCapabilityRegistryProgram,
  useTaskMarketProgram,
  useProofVerifierProgram,
  useTreasuryProgram,
  useGovernanceProgram,
  useNxsStakingProgram,
  useTemplateRegistryProgram,
} from '../hooks/program.js';
import { createWrapper, MOCK_CLUSTER, mockAnchorWallet, mockConnection, mockProgram } from './helpers.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockConnection();
});

describe('useProgram', () => {
  it('returns null and skips the factory when no wallet is connected', () => {
    const factory = vi.fn();
    const { result } = renderHook(() => useProgram(factory as any), { wrapper: createWrapper() });
    expect(result.current).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  it('invokes the factory with provider + cluster once a wallet is available', () => {
    mockAnchorWallet();
    const prog = mockProgram();
    const factory = vi.fn().mockReturnValue(prog);
    const { result } = renderHook(() => useProgram(factory as any), { wrapper: createWrapper() });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(expect.anything(), MOCK_CLUSTER);
    expect(result.current).toBe(prog);
  });
});

describe('program-hook wrappers', () => {
  const cases = [
    ['useAgentRegistryProgram', useAgentRegistryProgram, 'agentRegistryProgram'],
    ['useCapabilityRegistryProgram', useCapabilityRegistryProgram, 'capabilityRegistryProgram'],
    ['useTaskMarketProgram', useTaskMarketProgram, 'taskMarketProgram'],
    ['useProofVerifierProgram', useProofVerifierProgram, 'proofVerifierProgram'],
    ['useTreasuryProgram', useTreasuryProgram, 'treasuryStandardProgram'],
    ['useGovernanceProgram', useGovernanceProgram, 'governanceProgramProgram'],
    ['useNxsStakingProgram', useNxsStakingProgram, 'nxsStakingProgram'],
    ['useTemplateRegistryProgram', useTemplateRegistryProgram, 'templateRegistryProgram'],
  ] as const;

  for (const [name, hook, factoryKey] of cases) {
    it(`${name} delegates to sdk.${factoryKey}`, () => {
      mockAnchorWallet();
      const prog = mockProgram();
      const factory = vi.mocked(sdk[factoryKey] as any);
      factory.mockReturnValue(prog);

      const { result } = renderHook(() => hook(), { wrapper: createWrapper() });

      expect(factory).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledWith(expect.anything(), MOCK_CLUSTER);
      expect(result.current).toBe(prog);
    });
  }
});
