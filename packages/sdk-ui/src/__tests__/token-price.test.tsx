import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTokenPrice } from '../hooks/token-price.js';
import { createWrapper } from './helpers.js';

const MINT = 'So11111111111111111111111111111111111111112';

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe('useTokenPrice', () => {
  it('stays disabled when mint is null', async () => {
    const { result } = renderHook(() => useTokenPrice(null), { wrapper: createWrapper() });

    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches and numerically coerces the Jupiter price response', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ data: { [MINT]: { price: '1.2345' } } }), { status: 200 }),
    );

    const { result } = renderHook(() => useTokenPrice(MINT), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ price: 1.2345 });
    expect(fetchSpy).toHaveBeenCalledWith(`https://api.jup.ag/price/v2?ids=${MINT}`);
  });

  it('returns null when the mint entry has no price', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ data: { [MINT]: {} } }), { status: 200 }),
    );

    const { result } = renderHook(() => useTokenPrice(MINT), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('returns null when the mint is absent from the response', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));

    const { result } = renderHook(() => useTokenPrice(MINT), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('propagates Jupiter API errors on non-2xx', async () => {
    fetchSpy.mockResolvedValue(new Response('upstream down', { status: 503 }));

    const { result } = renderHook(() => useTokenPrice(MINT), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toContain('503');
  });
});
