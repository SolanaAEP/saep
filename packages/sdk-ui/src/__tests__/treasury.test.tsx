import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { TransactionInstruction, PublicKey } from '@solana/web3.js';
import {
  fetchAllowedMints,
  fetchStreamsByAgent,
  fetchVaultBalances,
  buildSetLimitsIx,
  treasuryStandardProgram,
} from '@saep/sdk';
import {
  useAllowedMints,
  useAgentStreams,
  useVaultBalances,
  useSetLimits,
  useTreasuryYieldResearch,
  rawToUsdMicro,
} from '../hooks/treasury.js';
import { createWrapper, createQueryClient, MOCK_PUBKEY, MOCK_PUBKEY_2, mockConnection, mockWallet, mockAnchorWallet } from './helpers.js';

const mockProgramInstance = { programId: MOCK_PUBKEY } as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockConnection();
  mockWallet();
  mockAnchorWallet();
  vi.mocked(treasuryStandardProgram).mockReturnValue(mockProgramInstance);
});

describe('useAllowedMints', () => {
  it('fetches allowed mints', async () => {
    const mints = [MOCK_PUBKEY, MOCK_PUBKEY_2];
    vi.mocked(fetchAllowedMints).mockResolvedValue(mints as any);

    const { result } = renderHook(() => useAllowedMints(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchAllowedMints).toHaveBeenCalledWith(mockProgramInstance);
    expect(result.current.data).toEqual(mints);
  });

  it('stays disabled when program is null', () => {
    vi.mocked(treasuryStandardProgram).mockReturnValue(null as any);

    const { result } = renderHook(() => useAllowedMints(), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useAgentStreams', () => {
  const agentDid = new Uint8Array(32).fill(0xab);

  it('fetches streams for agent', async () => {
    const streams = [{ id: 'stream-1', rate: 100 }];
    vi.mocked(fetchStreamsByAgent).mockResolvedValue(streams as any);

    const { result } = renderHook(() => useAgentStreams(agentDid), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchStreamsByAgent).toHaveBeenCalledWith(mockProgramInstance, agentDid);
    expect(result.current.data).toEqual(streams);
  });

  it('stays disabled when agentDid is null', () => {
    const { result } = renderHook(() => useAgentStreams(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useVaultBalances', () => {
  const agentDid = new Uint8Array(32).fill(0xcd);
  const mints = [MOCK_PUBKEY, MOCK_PUBKEY_2];

  it('fetches vault balances for agent + mints', async () => {
    const balances = [{ mint: MOCK_PUBKEY, amount: BigInt(500) }];
    vi.mocked(fetchVaultBalances).mockResolvedValue(balances as any);

    const { result } = renderHook(() => useVaultBalances(agentDid, mints), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchVaultBalances).toHaveBeenCalledWith(mockProgramInstance, agentDid, mints);
  });

  it('stays disabled when agentDid is null', () => {
    const { result } = renderHook(() => useVaultBalances(null, mints), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('stays disabled when mints array is empty', () => {
    const { result } = renderHook(() => useVaultBalances(agentDid, []), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useSetLimits', () => {
  const mockIx = new TransactionInstruction({
    keys: [],
    programId: MOCK_PUBKEY,
    data: Buffer.alloc(8),
  });

  it('builds ix, sends transaction, invalidates treasury queries', async () => {
    vi.mocked(buildSetLimitsIx).mockResolvedValue(mockIx);
    const qc = createQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useSetLimits(), {
      wrapper: createWrapper(qc),
    });

    const input = {
      agentDid: new Uint8Array(32).fill(1),
      mint: MOCK_PUBKEY,
      daily: BigInt(1_000_000),
      perTx: BigInt(100_000),
      weekly: BigInt(5_000_000),
    };

    await result.current.mutateAsync(input);

    expect(buildSetLimitsIx).toHaveBeenCalledWith(
      mockProgramInstance,
      expect.objectContaining({ operator: MOCK_PUBKEY }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe('mock-sig-abc123');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['treasury'] });
  });

  it('throws when wallet not connected', async () => {
    vi.mocked(treasuryStandardProgram).mockReturnValue(null as any);

    const { result } = renderHook(() => useSetLimits(), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.mutateAsync({
        agentDid: new Uint8Array(32),
        mint: MOCK_PUBKEY,
        daily: BigInt(0),
        perTx: BigInt(0),
        weekly: BigInt(0),
      }),
    ).rejects.toThrow('Wallet not connected');
  });

  it('throws when publicKey is missing', async () => {
    mockWallet({ publicKey: null });

    const { result } = renderHook(() => useSetLimits(), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.mutateAsync({
        agentDid: new Uint8Array(32),
        mint: MOCK_PUBKEY,
        daily: BigInt(0),
        perTx: BigInt(0),
        weekly: BigInt(0),
      }),
    ).rejects.toThrow('Missing wallet publicKey');
    expect(buildSetLimitsIx).not.toHaveBeenCalled();
  });
});

describe('useTreasuryYieldResearch', () => {
  const agentDid = new Uint8Array(32).fill(0xef);

  it('derives idle and deployable stablecoin balances', async () => {
    vi.mocked(fetchAllowedMints).mockResolvedValue([MOCK_PUBKEY] as any);
    vi.mocked(fetchVaultBalances).mockResolvedValue([
      {
        mint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
        vault: MOCK_PUBKEY,
        amount: 4_200_000n,
        exists: true,
      },
    ] as any);

    const { result } = renderHook(() => useTreasuryYieldResearch(agentDid), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data.snapshot.idleUsdMicro).toBe(4_200_000n);
    expect(result.current.data.deployableUsdMicro).toBe(1_050_000n);
    expect(result.current.data.blockedReasons).toEqual([]);
  });

  it('reports blocked reasons when no stable balances are available', async () => {
    vi.mocked(fetchAllowedMints).mockResolvedValue([MOCK_PUBKEY] as any);
    vi.mocked(fetchVaultBalances).mockResolvedValue([
      {
        mint: MOCK_PUBKEY,
        vault: MOCK_PUBKEY_2,
        amount: 99n,
        exists: false,
      },
    ] as any);

    const { result } = renderHook(() => useTreasuryYieldResearch(agentDid), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data.snapshot.status).toBe('inactive');
    expect(result.current.data.blockedReasons).toContain('no supported stable balances available');
  });

  it('reports paused and no-strategy policy states explicitly', async () => {
    vi.mocked(fetchAllowedMints).mockResolvedValue([MOCK_PUBKEY] as any);
    vi.mocked(fetchVaultBalances).mockResolvedValue([
      {
        mint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
        vault: MOCK_PUBKEY,
        amount: 2_000_000n,
        exists: true,
      },
    ] as any);

    const paused = renderHook(
      () =>
        useTreasuryYieldResearch(agentDid, {
          allowedStrategyIds: ['kamino-lend'],
          maxAllocationBps: 2_500,
          paused: true,
          emergencyUnwindEnabled: true,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(paused.result.current.isLoading).toBe(false));
    expect(paused.result.current.data.snapshot.status).toBe('paused');
    expect(paused.result.current.data.blockedReasons).toContain('policy paused');

    const noStrategy = renderHook(
      () =>
        useTreasuryYieldResearch(agentDid, {
          allowedStrategyIds: [],
          maxAllocationBps: 2_500,
          paused: false,
          emergencyUnwindEnabled: true,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(noStrategy.result.current.isLoading).toBe(false));
    expect(noStrategy.result.current.data.snapshot.status).toBe('inactive');
    expect(noStrategy.result.current.data.snapshot.strategyId).toBeNull();
    expect(noStrategy.result.current.data.blockedReasons).toContain('no active strategy selected');
  });
});

describe('rawToUsdMicro', () => {
  it('returns zero for non-stable mints and rescales stable decimals around 6', () => {
    expect(rawToUsdMicro(123n, 9, false)).toBe(0n);
    expect(rawToUsdMicro(1_234_567_890n, 9, true)).toBe(1_234_567n);
    expect(rawToUsdMicro(12_345n, 4, true)).toBe(1_234_500n);
  });
});
