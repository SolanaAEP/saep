import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { Transaction } from '@solana/web3.js';
import { useSettlementBundle } from '../hooks/settlement.js';
import {
  createWrapper,
  createQueryClient,
  mockConnection,
  mockWallet,
  MOCK_PUBKEY,
} from './helpers.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useSettlementBundle', () => {
  const makeSubmitter = (bundleId = 'bundle-123') => ({
    submitBundle: vi.fn().mockResolvedValue(bundleId),
    getInflightBundleStatus: vi.fn().mockResolvedValue('Landed' as any),
  });

  it('submits a jito bundle and returns the bundle id', async () => {
    mockConnection();
    mockWallet();
    const submitter = makeSubmitter();
    const tx = new Transaction();
    const bundleBuilder = vi.fn().mockResolvedValue([tx]);

    const { result } = renderHook(
      () =>
        useSettlementBundle({
          submitter: submitter as any,
          bundleBuilder,
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.mutate({ taskId: 'abc' } as any);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(bundleBuilder).toHaveBeenCalledWith({ taskId: 'abc' });
    expect(submitter.submitBundle).toHaveBeenCalledWith([tx]);
    expect(result.current.data?.bundleId).toBe('bundle-123');
    expect(result.current.data?.inflightStatus).toBeUndefined();
  });

  it('polls inflight status when enabled', async () => {
    mockConnection();
    mockWallet();
    const submitter = makeSubmitter();
    const tx = new Transaction();

    const { result } = renderHook(
      () =>
        useSettlementBundle({
          submitter: submitter as any,
          bundleBuilder: async () => [tx],
          pollInflight: true,
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.mutate(undefined as any);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(submitter.getInflightBundleStatus).toHaveBeenCalledWith('bundle-123');
    expect(result.current.data?.inflightStatus).toBe('Landed');
  });

  it('errors when bundleBuilder returns empty array', async () => {
    mockConnection();
    mockWallet();
    const submitter = makeSubmitter();

    const { result } = renderHook(
      () =>
        useSettlementBundle({
          submitter: submitter as any,
          bundleBuilder: async () => [],
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.mutate(undefined as any);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('bundleBuilder returned no txs');
  });

  it('errors when wallet not connected', async () => {
    mockConnection();
    mockWallet({ publicKey: null });
    const submitter = makeSubmitter();

    const { result } = renderHook(
      () =>
        useSettlementBundle({
          submitter: submitter as any,
          bundleBuilder: async () => [new Transaction()],
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.mutate(undefined as any);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Wallet not connected');
  });

  it('invalidates keys on success', async () => {
    mockConnection();
    mockWallet();
    const submitter = makeSubmitter();
    const qc = createQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(
      () =>
        useSettlementBundle({
          submitter: submitter as any,
          bundleBuilder: async () => [new Transaction()],
          invalidateKeys: [['settlement'], ['tasks']],
        }),
      { wrapper: createWrapper(qc) },
    );

    act(() => {
      result.current.mutate(undefined as any);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['settlement'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks'] });
  });

  it('forwards onSuccess callback', async () => {
    mockConnection();
    mockWallet();
    const submitter = makeSubmitter();
    const onSuccess = vi.fn();

    const { result } = renderHook(
      () =>
        useSettlementBundle(
          {
            submitter: submitter as any,
            bundleBuilder: async () => [new Transaction()],
          },
          { onSuccess },
        ),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.mutate(undefined as any);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess.mock.calls[0][0].bundleId).toBe('bundle-123');
  });
});
