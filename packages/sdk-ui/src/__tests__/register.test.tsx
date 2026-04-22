import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { TransactionInstruction, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
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

  it('uses the token-2022 program when the stake mint owner matches it', async () => {
    mockConnection({
      getAccountInfo: vi.fn().mockResolvedValue({ owner: TOKEN_2022_PROGRAM_ID }),
    });

    const { result } = renderHook(() => useRegisterAgent(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      agentId: new Uint8Array(32).fill(2),
      manifestUri: new Uint8Array(128),
      capabilityMask: BigInt(1),
      priceLamports: BigInt(10),
      streamRate: BigInt(0),
      stakeAmount: BigInt(5),
      stakeMint: new PublicKey('6UpQcMAb5xMzxc7ZfPaVMgx3KqsvKZdT5U718BzD5We2'),
    });

    expect(buildRegisterAgentIx).toHaveBeenCalledWith(
      mockProgramInstance,
      expect.objectContaining({ tokenProgramId: TOKEN_2022_PROGRAM_ID }),
    );
  });

  it('throws when the stake mint account is missing', async () => {
    mockConnection({
      getAccountInfo: vi.fn().mockResolvedValue(null),
    });

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
    ).rejects.toThrow('Stake mint not found on the current cluster');
  });

  it('throws when the stake mint owner is neither SPL Token nor Token-2022', async () => {
    mockConnection({
      getAccountInfo: vi.fn().mockResolvedValue({ owner: PublicKey.unique() }),
    });

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
    ).rejects.toThrow('Stake mint is not owned by SPL Token or Token-2022');
  });
});
