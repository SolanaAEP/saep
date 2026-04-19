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
import { useAllowedMints, useAgentStreams, useVaultBalances, useSetLimits } from '../hooks/treasury.js';
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
});
