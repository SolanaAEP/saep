import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  useIndexedTreasuryYield,
  useIndexedYieldStrategies,
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

afterEach(() => {
  vi.unstubAllGlobals();
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

describe('indexed treasury yield hooks', () => {
  const INDEXER = 'https://idx.example.com';
  const didHex = 'a'.repeat(64);
  const strategyHex = 'b'.repeat(64);

  it('maps indexed strategy snapshots', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              strategy_id_hex: strategyHex,
              venue: 'kamino',
              strategy_program: 'Kamino111111111111111111111111111111111',
              underlying_mint: 'USDC11111111111111111111111111111111111',
              receipt_mint: 'kUSDC1111111111111111111111111111111111',
              max_allocation_bps: 2500,
              risk_tier: 'conservative',
              status: 'active',
              name: 'Kamino USDC lend',
              metadata_uri: 'ipfs://kamino',
              registered_unix: 1700000000,
              status_updated_unix: null,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(
      () => useIndexedYieldStrategies({ indexerUrl: `${INDEXER}/`, venue: 'kamino', status: 'active', limit: 5 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${INDEXER}/v1/discovery/treasury/yield-strategies?venue=kamino&status=active&limit=5`,
    );
    expect(result.current.data?.[0]).toMatchObject({
      strategyIdHex: strategyHex,
      maxAllocationBps: 2500,
      metadataUri: 'ipfs://kamino',
    });
  });

  it('maps indexed treasury yield snapshots and treats 404 as unconfigured', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            did_hex: didHex,
            strategy_id_hex: strategyHex,
            allocation_bps: 1500,
            status: 'active',
            unwind_requested: false,
            idle_amount: '1000000',
            deployed_amount: '250000',
            realized_yield_amount: '12345',
            accounting_slot: 99,
            configured_unix: 1700000000,
            unwind_requested_unix: null,
            accounting_updated_unix: 1700000200,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('missing', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(
      () => useIndexedTreasuryYield({ indexerUrl: INDEXER, agentDidHex: didHex }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      didHex,
      strategyIdHex: strategyHex,
      allocationBps: 1500,
      deployedAmount: '250000',
    });

    const missing = renderHook(
      () => useIndexedTreasuryYield({ indexerUrl: INDEXER, agentDidHex: 'c'.repeat(64) }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(missing.result.current.isSuccess).toBe(true));
    expect(missing.result.current.data).toBeNull();
  });
});

describe('rawToUsdMicro', () => {
  it('returns zero for non-stable mints and rescales stable decimals around 6', () => {
    expect(rawToUsdMicro(123n, 9, false)).toBe(0n);
    expect(rawToUsdMicro(1_234_567_890n, 9, true)).toBe(1_234_567n);
    expect(rawToUsdMicro(12_345n, 4, true)).toBe(1_234_500n);
  });
});
