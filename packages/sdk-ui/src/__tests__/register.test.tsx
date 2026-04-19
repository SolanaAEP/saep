import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { TransactionInstruction, PublicKey } from '@solana/web3.js';
import { buildRegisterAgentIx, agentRegistryProgram } from '@saep/sdk';
import { useRegisterAgent } from '../hooks/register.js';
import { createWrapper, createQueryClient, MOCK_PUBKEY, mockConnection, mockWallet, mockAnchorWallet } from './helpers.js';

const mockProgramInstance = { programId: MOCK_PUBKEY } as any;

const mockIx = new TransactionInstruction({
  keys: [],
  programId: MOCK_PUBKEY,
  data: Buffer.alloc(8),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockConnection();
  mockWallet();
  mockAnchorWallet();
  vi.mocked(agentRegistryProgram).mockReturnValue(mockProgramInstance);
  vi.mocked(buildRegisterAgentIx).mockResolvedValue(mockIx);
});

describe('useRegisterAgent', () => {
  it('builds ix, sends transaction, and confirms', async () => {
    const qc = createQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useRegisterAgent(), {
      wrapper: createWrapper(qc),
    });

    const input = {
      agentId: new Uint8Array(32).fill(1),
      manifestUri: new Uint8Array(128).fill(0),
      capabilityMask: BigInt(0xff),
      priceLamports: BigInt(1000),
      streamRate: BigInt(0),
      stakeAmount: BigInt(100_000),
    };

    await result.current.mutateAsync(input);

    expect(buildRegisterAgentIx).toHaveBeenCalledWith(
      mockProgramInstance,
      expect.objectContaining({ operator: MOCK_PUBKEY }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe('mock-sig-abc123');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['agents'] });
  });

  it('throws when wallet not connected', async () => {
    mockAnchorWallet();
    vi.mocked(agentRegistryProgram).mockReturnValue(null as any);

    const { result } = renderHook(() => useRegisterAgent(), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.mutateAsync({
        agentId: new Uint8Array(32),
        manifestUri: new Uint8Array(128),
        capabilityMask: BigInt(0),
        priceLamports: BigInt(0),
        streamRate: BigInt(0),
        stakeAmount: BigInt(0),
      }),
    ).rejects.toThrow('Wallet not connected');
  });

  it('throws when publicKey is null', async () => {
    mockWallet({ publicKey: null });

    const { result } = renderHook(() => useRegisterAgent(), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.mutateAsync({
        agentId: new Uint8Array(32),
        manifestUri: new Uint8Array(128),
        capabilityMask: BigInt(0),
        priceLamports: BigInt(0),
        streamRate: BigInt(0),
        stakeAmount: BigInt(0),
      }),
    ).rejects.toThrow('Missing wallet publicKey');
  });
});
