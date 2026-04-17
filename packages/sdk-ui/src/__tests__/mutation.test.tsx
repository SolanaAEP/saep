import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { TransactionInstruction, PublicKey, Transaction } from '@solana/web3.js';
import { useConnection } from '@solana/wallet-adapter-react';
import {
  clampPriorityFee,
  getHeliusPriorityFeeEstimate,
  withPriorityFee,
} from '@saep/sdk';
import { useSendTransaction, SimulationError } from '../hooks/mutation.js';
import {
  createWrapper,
  createQueryClient,
  mockConnection,
  mockWallet,
  MOCK_PUBKEY,
} from './helpers.js';

const dummyIx = new TransactionInstruction({
  keys: [],
  programId: MOCK_PUBKEY,
  data: Buffer.from([]),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useSendTransaction', () => {
  it('throws when wallet not connected', async () => {
    mockConnection();
    mockWallet({ publicKey: null });
    const wrapper = createWrapper();

    const { result } = renderHook(
      () =>
        useSendTransaction({
          buildInstruction: async () => dummyIx,
        }),
      { wrapper },
    );

    act(() => {
      result.current.mutate(undefined as any);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Wallet not connected');
  });

  it('builds tx, simulates, sends, confirms', async () => {
    const conn = mockConnection();
    const wallet = mockWallet();
    const buildInstruction = vi.fn().mockResolvedValue(dummyIx);
    const onSimulated = vi.fn();
    const wrapper = createWrapper();

    const { result } = renderHook(
      () =>
        useSendTransaction({
          buildInstruction,
          onSimulated,
        }),
      { wrapper },
    );

    act(() => {
      result.current.mutate({ foo: 'bar' } as any);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(buildInstruction).toHaveBeenCalledWith({ foo: 'bar' });
    expect(conn.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(wallet.sendTransaction).toHaveBeenCalledTimes(1);
    expect(conn.confirmTransaction).toHaveBeenCalledTimes(1);
    expect(onSimulated).toHaveBeenCalledWith(
      { slot: 0, unitsConsumed: 200_000, logs: ['log1'] },
      { foo: 'bar' },
    );
    expect(result.current.data?.signature).toBe('mock-sig-abc123');
  });

  it('handles array of instructions', async () => {
    mockConnection();
    mockWallet();
    const ix2 = new TransactionInstruction({
      keys: [],
      programId: MOCK_PUBKEY,
      data: Buffer.from([1]),
    });
    const wrapper = createWrapper();

    const { result } = renderHook(
      () =>
        useSendTransaction({
          buildInstruction: async () => [dummyIx, ix2],
        }),
      { wrapper },
    );

    act(() => {
      result.current.mutate(undefined as any);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('throws SimulationError on failed simulation', async () => {
    mockConnection({
      simulateTransaction: vi.fn().mockResolvedValue({
        value: {
          err: { InstructionError: [0, 'Custom'] },
          logs: ['Program failed'],
        },
      }),
    });
    mockWallet();
    const wrapper = createWrapper();

    const { result } = renderHook(
      () =>
        useSendTransaction({
          buildInstruction: async () => dummyIx,
        }),
      { wrapper },
    );

    act(() => {
      result.current.mutate(undefined as any);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(SimulationError);
    expect((result.current.error as SimulationError).logs).toBe('Program failed');
  });

  it('applies optimistic updates and rolls back on error', async () => {
    mockConnection({
      simulateTransaction: vi.fn().mockRejectedValue(new Error('net fail')),
    });
    mockWallet();
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false },
      },
    });
    const wrapper = createWrapper(qc);

    qc.setQueryData(['counter'], 10);

    const { result } = renderHook(
      () =>
        useSendTransaction<number>({
          buildInstruction: async () => dummyIx,
          optimisticUpdates: [
            { queryKey: ['counter'], updater: (old, input) => (old as number) + input },
          ],
        }),
      { wrapper },
    );

    act(() => {
      result.current.mutate(5);
    });

    // after the error, the rollback should restore original value
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData(['counter'])).toBe(10);
  });

  it('invalidates keys on success', async () => {
    mockConnection();
    mockWallet();
    const qc = createQueryClient();
    const wrapper = createWrapper(qc);

    qc.setQueryData(['agents', 'all'], [{ id: 1 }]);
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(
      () =>
        useSendTransaction({
          buildInstruction: async () => dummyIx,
          invalidateKeys: [['agents', 'all'], ['tasks']],
        }),
      { wrapper },
    );

    act(() => {
      result.current.mutate(undefined as any);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['agents', 'all'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks'] });
  });

  it('uses staked submitter when provided', async () => {
    mockConnection();
    const wallet = mockWallet();
    const submit = vi.fn().mockResolvedValue('staked-sig-xyz');
    const submitter = { submit } as any;
    const wrapper = createWrapper();

    const { result } = renderHook(
      () =>
        useSendTransaction({
          buildInstruction: async () => dummyIx,
          submitter,
        }),
      { wrapper },
    );

    act(() => {
      result.current.mutate(undefined as any);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
    expect(result.current.data?.signature).toBe('staked-sig-xyz');
  });

  it('applies priority fee config', async () => {
    mockConnection();
    mockWallet();
    vi.mocked(clampPriorityFee).mockReturnValue(5000);
    const wrapper = createWrapper();

    const { result } = renderHook(
      () =>
        useSendTransaction({
          buildInstruction: async () => dummyIx,
          priorityFee: { microLamports: 5000, cuLimit: 400_000 },
        }),
      { wrapper },
    );

    act(() => {
      result.current.mutate(undefined as any);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(clampPriorityFee).toHaveBeenCalled();
    expect(withPriorityFee).toHaveBeenCalled();
  });

  it('auto priority fee falls back gracefully on serialization error', async () => {
    mockConnection();
    mockWallet();
    vi.mocked(clampPriorityFee).mockReturnValue(0);
    const wrapper = createWrapper();

    const { result } = renderHook(
      () =>
        useSendTransaction({
          buildInstruction: async () => dummyIx,
          priorityFee: 'auto',
        }),
      { wrapper },
    );

    act(() => {
      result.current.mutate(undefined as any);
    });

    // should succeed even when the estimate call fails internally
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.signature).toBe('mock-sig-abc123');
  });

  it('forwards mutation callbacks', async () => {
    mockConnection();
    mockWallet();
    const wrapper = createWrapper();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onSettled = vi.fn();

    const { result } = renderHook(
      () =>
        useSendTransaction(
          { buildInstruction: async () => dummyIx },
          { onSuccess, onError, onSettled },
        ),
      { wrapper },
    );

    act(() => {
      result.current.mutate(undefined as any);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
});
