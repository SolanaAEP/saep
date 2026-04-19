import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { fetchCategoryReputation, fetchCategoryReputationsByAgent, agentRegistryProgram } from '@saep/sdk';
import { useLeaderboard, useAgentReputation, useRetroEligibility, useAgentCategoryReputation, useAgentCategoryReputations } from '../hooks/reputation.js';
import { createWrapper, MOCK_PUBKEY, mockConnection, mockAnchorWallet } from './helpers.js';

const mockProgramInstance = { programId: MOCK_PUBKEY } as any;
const INDEXER = 'https://indexer.example.com';

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockConnection();
  mockAnchorWallet();
  vi.mocked(agentRegistryProgram).mockReturnValue(mockProgramInstance);
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe('useLeaderboard', () => {
  const rawRows = [
    {
      agent_did_hex: 'a'.repeat(64),
      capability_bit: 0,
      quality: 85,
      timeliness: 90,
      availability: 95,
      cost_efficiency: 80,
      honesty: 100,
      jobs_completed: 50,
      jobs_disputed: 2,
      composite_score: 88,
      last_update_unix: 1700000000,
    },
  ];

  it('fetches and transforms leaderboard data', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(rawRows), { status: 200 }));

    const { result } = renderHook(
      () => useLeaderboard({ indexerUrl: INDEXER, capabilityBit: 0 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data![0].agentDidHex).toBe('a'.repeat(64));
    expect(result.current.data![0].costEfficiency).toBe(80);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/leaderboard?capability=0'),
      expect.any(Object),
    );
  });

  it('passes limit and cursor params', async () => {
    fetchSpy.mockResolvedValue(new Response('[]', { status: 200 }));

    const { result } = renderHook(
      () => useLeaderboard({ indexerUrl: INDEXER, capabilityBit: 3, limit: 10, cursor: 5 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calledUrl = (fetchSpy.mock.calls[0][0] as string);
    expect(calledUrl).toContain('limit=10');
    expect(calledUrl).toContain('cursor=5');
  });

  it('propagates indexer errors', async () => {
    fetchSpy.mockResolvedValue(new Response('server error', { status: 500 }));

    const { result } = renderHook(
      () => useLeaderboard({ indexerUrl: INDEXER, capabilityBit: 0 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/indexer 500/);
  });
});

describe('useAgentReputation', () => {
  const validHex = 'b'.repeat(64);

  it('fetches reputation for valid DID hex', async () => {
    fetchSpy.mockResolvedValue(new Response('[]', { status: 200 }));

    const { result } = renderHook(
      () => useAgentReputation({ indexerUrl: INDEXER, agentDidHex: validHex }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining(`/agents/${validHex}/reputation`),
      expect.any(Object),
    );
  });

  it('stays disabled for null DID', () => {
    const { result } = renderHook(
      () => useAgentReputation({ indexerUrl: INDEXER, agentDidHex: null }),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('stays disabled for short DID hex', () => {
    const { result } = renderHook(
      () => useAgentReputation({ indexerUrl: INDEXER, agentDidHex: 'tooshort' }),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useRetroEligibility', () => {
  const validHex = 'c'.repeat(64);

  it('fetches retro eligibility and transforms snake_case', async () => {
    const raw = {
      operator_hex: validHex,
      net_fees_micro_usdc: 50000,
      wash_excluded_micro_usdc: 1000,
      personhood_tier: 'verified',
      personhood_multiplier: '1.5',
      cold_start_multiplier: '1.0',
      estimated_allocation: '500.00',
      epoch_first_seen: 100,
      last_updated_unix: 1700000000,
    };
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(raw), { status: 200 }));

    const { result } = renderHook(
      () => useRetroEligibility({ indexerUrl: INDEXER, operatorHex: validHex }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.operatorHex).toBe(validHex);
    expect(result.current.data?.netFeesMicroUsdc).toBe(50000);
    expect(result.current.data?.personhoodTier).toBe('verified');
  });

  it('returns null on 404', async () => {
    fetchSpy.mockResolvedValue(new Response('', { status: 404 }));

    const { result } = renderHook(
      () => useRetroEligibility({ indexerUrl: INDEXER, operatorHex: validHex }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('stays disabled for short operator hex', () => {
    const { result } = renderHook(
      () => useRetroEligibility({ indexerUrl: INDEXER, operatorHex: 'short' }),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useAgentCategoryReputation', () => {
  const agentDid = new Uint8Array(32).fill(0xaa);

  it('fetches category reputation via SDK', async () => {
    const summary = { bit: 5, score: 92 };
    vi.mocked(fetchCategoryReputation).mockResolvedValue(summary as any);

    const { result } = renderHook(
      () => useAgentCategoryReputation({ agentDid, capabilityBit: 5 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchCategoryReputation).toHaveBeenCalledWith(mockProgramInstance, agentDid, 5);
    expect(result.current.data).toEqual(summary);
  });

  it('stays disabled when agentDid is null', () => {
    const { result } = renderHook(
      () => useAgentCategoryReputation({ agentDid: null, capabilityBit: 5 }),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('stays disabled when capabilityBit is null', () => {
    const { result } = renderHook(
      () => useAgentCategoryReputation({ agentDid, capabilityBit: null }),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('stays disabled for wrong-length DID', () => {
    const { result } = renderHook(
      () => useAgentCategoryReputation({ agentDid: new Uint8Array(16), capabilityBit: 0 }),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useAgentCategoryReputations', () => {
  const agentDid = new Uint8Array(32).fill(0xbb);

  it('fetches all category reputations', async () => {
    const summaries = [{ bit: 0, score: 80 }, { bit: 1, score: 90 }];
    vi.mocked(fetchCategoryReputationsByAgent).mockResolvedValue(summaries as any);

    const { result } = renderHook(
      () => useAgentCategoryReputations({ agentDid }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchCategoryReputationsByAgent).toHaveBeenCalledWith(mockProgramInstance, agentDid);
    expect(result.current.data).toHaveLength(2);
  });

  it('stays disabled when agentDid is null', () => {
    const { result } = renderHook(
      () => useAgentCategoryReputations({ agentDid: null }),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe('idle');
  });
});
