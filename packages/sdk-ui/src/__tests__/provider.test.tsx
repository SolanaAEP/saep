import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { AnchorProvider } from '@coral-xyz/anchor';
import { useAnchorWallet } from '@solana/wallet-adapter-react';
import { useAnchorProvider } from '../hooks/provider.js';
import { createWrapper, MOCK_PUBKEY, mockAnchorWallet, mockConnection } from './helpers.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockConnection();
});

describe('useAnchorProvider', () => {
  it('returns null when no wallet is connected', () => {
    vi.mocked(useAnchorWallet).mockReturnValue(undefined);
    const { result } = renderHook(() => useAnchorProvider(), { wrapper: createWrapper() });
    expect(result.current).toBeNull();
  });

  it('builds an AnchorProvider when a wallet is connected', () => {
    const wallet = mockAnchorWallet();
    const { result } = renderHook(() => useAnchorProvider(), { wrapper: createWrapper() });
    expect(result.current).toBeInstanceOf(AnchorProvider);
    expect(result.current?.wallet.publicKey.equals(wallet.publicKey)).toBe(true);
    expect(result.current?.opts.commitment).toBe('confirmed');
  });

  it('memoizes across renders when wallet identity is stable', () => {
    mockAnchorWallet();
    const { result, rerender } = renderHook(() => useAnchorProvider(), {
      wrapper: createWrapper(),
    });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('returns a fresh provider when the wallet swaps', () => {
    mockAnchorWallet();
    const { result, rerender } = renderHook(() => useAnchorProvider(), {
      wrapper: createWrapper(),
    });
    const first = result.current;
    expect(first).not.toBeNull();

    vi.mocked(useAnchorWallet).mockReturnValue({
      publicKey: MOCK_PUBKEY,
      signTransaction: vi.fn(),
      signAllTransactions: vi.fn(),
    } as any);
    rerender();

    expect(result.current).not.toBe(first);
    expect(result.current).toBeInstanceOf(AnchorProvider);
  });
});
