import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { PublicKey } from '@solana/web3.js';
import { useTokenBalance } from '../hooks/token-balance.js';
import { createWrapper, mockConnection, MOCK_PUBKEY, MOCK_PUBKEY_2 } from './helpers.js';

vi.mock('@solana/spl-token', () => ({
  AccountLayout: {
    decode: vi.fn((_data: Buffer) => ({ amount: 1_000_000_000n })),
  },
}));

const OWNER = MOCK_PUBKEY;
const MINT = MOCK_PUBKEY_2;

const TOKEN_ACCOUNT_RESP = {
  value: [
    {
      pubkey: new PublicKey('11111111111111111111111111111113'),
      account: { data: Buffer.alloc(165), executable: false, lamports: 2_039_280, owner: MINT, rentEpoch: 0 },
    },
  ],
};

function parsedMintInfo(decimals: number) {
  return {
    context: { slot: 1 },
    value: { data: { parsed: { info: { decimals }, type: 'mint' }, program: 'spl-token', space: 82 } },
  };
}

let conn: ReturnType<typeof mockConnection>;

beforeEach(() => {
  vi.clearAllMocks();
  conn = mockConnection({
    getTokenAccountsByOwner: vi.fn().mockResolvedValue(TOKEN_ACCOUNT_RESP),
    getParsedAccountInfo: vi.fn().mockResolvedValue(parsedMintInfo(6)),
  });
});

describe('useTokenBalance', () => {
  it('stays disabled when owner is null', () => {
    const { result } = renderHook(() => useTokenBalance(null, MINT), { wrapper: createWrapper() });

    expect(result.current.fetchStatus).toBe('idle');
    expect(conn.getTokenAccountsByOwner).not.toHaveBeenCalled();
  });

  it('stays disabled when mint is null', () => {
    const { result } = renderHook(() => useTokenBalance(OWNER, null), { wrapper: createWrapper() });

    expect(result.current.fetchStatus).toBe('idle');
    expect(conn.getTokenAccountsByOwner).not.toHaveBeenCalled();
  });

  it('returns null when owner holds no token account for the mint', async () => {
    conn.getTokenAccountsByOwner = vi.fn().mockResolvedValue({ value: [] });

    const { result } = renderHook(() => useTokenBalance(OWNER, MINT), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(conn.getParsedAccountInfo).not.toHaveBeenCalled();
  });

  it('decodes balance and derives uiAmount from parsed mint decimals', async () => {
    const { result } = renderHook(() => useTokenBalance(OWNER, MINT), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ balance: 1_000_000_000, decimals: 6, uiAmount: 1_000 });
    expect(conn.getTokenAccountsByOwner).toHaveBeenCalledWith(
      expect.any(PublicKey),
      { mint: expect.any(PublicKey) },
    );
  });

  it('falls back to decimals=9 when mint info is not parsed', async () => {
    conn.getParsedAccountInfo = vi.fn().mockResolvedValue({
      context: { slot: 1 },
      value: { data: Buffer.alloc(82), executable: false, lamports: 0, owner: MINT, rentEpoch: 0 },
    });

    const { result } = renderHook(() => useTokenBalance(OWNER, MINT), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ balance: 1_000_000_000, decimals: 9, uiAmount: 1 });
  });

  it('falls back to decimals=9 when mint account is absent', async () => {
    conn.getParsedAccountInfo = vi.fn().mockResolvedValue({ context: { slot: 1 }, value: null });

    const { result } = renderHook(() => useTokenBalance(OWNER, MINT), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ balance: 1_000_000_000, decimals: 9, uiAmount: 1 });
  });
});
