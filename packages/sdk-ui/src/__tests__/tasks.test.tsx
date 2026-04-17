import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { useAnchorWallet } from '@solana/wallet-adapter-react';
import {
  fetchTaskById,
  fetchTasksByClient,
  buildRaiseDisputeIx,
  taskMarketProgram,
} from '@saep/sdk';
import { useTask, useTasksByClient, useRaiseDispute } from '../hooks/tasks.js';
import {
  createWrapper,
  createQueryClient,
  mockConnection,
  mockWallet,
  mockAnchorWallet,
  MOCK_PUBKEY,
  MOCK_PUBKEY_2,
} from './helpers.js';

const mockProgramInstance = { programId: MOCK_PUBKEY } as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockConnection();
  mockAnchorWallet();
  vi.mocked(taskMarketProgram).mockReturnValue(mockProgramInstance);
});

describe('useTask', () => {
  const validHex = 'c'.repeat(64);

  it('fetches a task by id hex', async () => {
    const task = { id: validHex, status: 'open' };
    vi.mocked(fetchTaskById).mockResolvedValue(task as any);

    const { result } = renderHook(() => useTask(validHex), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchTaskById).toHaveBeenCalledWith(mockProgramInstance, validHex);
    expect(result.current.data).toEqual(task);
  });

  it('stays disabled for null taskIdHex', () => {
    const { result } = renderHook(() => useTask(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('stays disabled for short hex', () => {
    const { result } = renderHook(() => useTask('deadbeef'), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useTasksByClient', () => {
  it('fetches tasks for a client public key', async () => {
    const tasks = [{ id: '1' }, { id: '2' }];
    vi.mocked(fetchTasksByClient).mockResolvedValue(tasks as any);

    const { result } = renderHook(() => useTasksByClient(MOCK_PUBKEY), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchTasksByClient).toHaveBeenCalledWith(mockProgramInstance, MOCK_PUBKEY);
    expect(result.current.data).toEqual(tasks);
  });

  it('stays disabled when client is null', () => {
    const { result } = renderHook(() => useTasksByClient(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useRaiseDispute', () => {
  it('builds dispute ix, sends, confirms, and invalidates cache', async () => {
    const conn = mockConnection();
    const wallet = mockWallet();
    const qc = createQueryClient();
    qc.setQueryData(['task', 'xyz'], { status: 'active' });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const ix = new TransactionInstruction({
      keys: [],
      programId: MOCK_PUBKEY,
      data: Buffer.from([]),
    });
    vi.mocked(buildRaiseDisputeIx).mockResolvedValue(ix);

    const { result } = renderHook(() => useRaiseDispute(), {
      wrapper: createWrapper(qc),
    });

    act(() => {
      result.current.mutate(MOCK_PUBKEY_2);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(buildRaiseDisputeIx).toHaveBeenCalledWith(mockProgramInstance, {
      task: MOCK_PUBKEY_2,
      client: MOCK_PUBKEY,
    });
    expect(wallet.sendTransaction).toHaveBeenCalledTimes(1);
    expect(conn.confirmTransaction).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['task'] });
  });

  it('errors when wallet not connected', async () => {
    mockWallet({ publicKey: null });
    vi.mocked(useAnchorWallet).mockReturnValue(undefined as any);

    const { result } = renderHook(() => useRaiseDispute(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(MOCK_PUBKEY);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
