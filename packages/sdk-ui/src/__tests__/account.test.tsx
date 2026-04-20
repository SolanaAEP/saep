import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { PublicKey } from '@solana/web3.js';
import { useConnection } from '@solana/wallet-adapter-react';
import { useAccountInfo, useDecodedAccount, useAnchorAccount } from '../hooks/account.js';
import { createQueryClient, createWrapper, MOCK_PUBKEY, mockConnection } from './helpers.js';

type SubCallback = (info: { data: Buffer; lamports: number }) => void;

function captureSubscribeCallback(overrides: Record<string, unknown> = {}) {
  const captured: { cb: SubCallback | null } = { cb: null };
  return {
    ...mockConnection({
      ...overrides,
      onAccountChange: vi.fn().mockImplementation((_addr: unknown, cb: SubCallback) => {
        captured.cb = cb;
        return 42;
      }),
      removeAccountChangeListener: vi.fn(),
    }),
    captured,
  };
}

let conn: ReturnType<typeof mockConnection>;

beforeEach(() => {
  vi.clearAllMocks();
  conn = mockConnection({
    getAccountInfo: vi.fn().mockResolvedValue({
      data: Buffer.from([1, 2, 3]),
      lamports: 1_000_000,
      owner: MOCK_PUBKEY,
      executable: false,
      rentEpoch: 0,
    }),
    onAccountChange: vi.fn().mockReturnValue(42),
    removeAccountChangeListener: vi.fn(),
  });
});

describe('useAccountInfo', () => {
  it('fetches account info for a pubkey', async () => {
    const { result } = renderHook(() => useAccountInfo(MOCK_PUBKEY), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(conn.getAccountInfo).toHaveBeenCalledWith(MOCK_PUBKEY, 'confirmed');
    expect(result.current.data?.lamports).toBe(1_000_000);
  });

  it('stays disabled when address is null', () => {
    const { result } = renderHook(() => useAccountInfo(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(conn.getAccountInfo).not.toHaveBeenCalled();
  });

  it('sets up subscription by default', () => {
    renderHook(() => useAccountInfo(MOCK_PUBKEY), {
      wrapper: createWrapper(),
    });

    expect(conn.onAccountChange).toHaveBeenCalledWith(
      expect.any(PublicKey),
      expect.any(Function),
      'confirmed',
    );
  });

  it('skips subscription when subscribe=false', () => {
    renderHook(() => useAccountInfo(MOCK_PUBKEY, { subscribe: false }), {
      wrapper: createWrapper(),
    });

    expect(conn.onAccountChange).not.toHaveBeenCalled();
  });

  it('cleans up subscription on unmount', () => {
    const { unmount } = renderHook(() => useAccountInfo(MOCK_PUBKEY), {
      wrapper: createWrapper(),
    });

    unmount();
    expect(conn.removeAccountChangeListener).toHaveBeenCalledWith(42);
  });

  it('uses custom commitment', async () => {
    const { result } = renderHook(
      () => useAccountInfo(MOCK_PUBKEY, { commitment: 'finalized' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(conn.getAccountInfo).toHaveBeenCalledWith(MOCK_PUBKEY, 'finalized');
  });

  it('updates query cache when subscription fires', async () => {
    const { captured } = captureSubscribeCallback();
    const qc = createQueryClient();
    renderHook(() => useAccountInfo(MOCK_PUBKEY), { wrapper: createWrapper(qc) });

    const update = { data: Buffer.from([9, 9]), lamports: 42 };
    act(() => captured.cb?.(update));

    expect(qc.getQueryData(['account', MOCK_PUBKEY.toBase58()])).toEqual(update);
  });
});

describe('useDecodedAccount', () => {
  const mockCoder = {
    decode: vi.fn().mockReturnValue({ name: 'decoded-account' }),
  } as any;

  it('fetches and decodes account data', async () => {
    const { result } = renderHook(
      () => useDecodedAccount(MOCK_PUBKEY, { coder: mockCoder, accountName: 'TestAccount' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockCoder.decode).toHaveBeenCalledWith('TestAccount', expect.any(Buffer));
    expect(result.current.data).toEqual({ name: 'decoded-account' });
  });

  it('applies transform function', async () => {
    const transform = vi.fn().mockReturnValue({ transformed: true });

    const { result } = renderHook(
      () => useDecodedAccount(MOCK_PUBKEY, { coder: mockCoder, accountName: 'TestAccount', transform }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(transform).toHaveBeenCalledWith({ name: 'decoded-account' });
    expect(result.current.data).toEqual({ transformed: true });
  });

  it('returns null when account not found', async () => {
    conn.getAccountInfo = vi.fn().mockResolvedValue(null);
    vi.mocked(useConnection).mockReturnValue({ connection: conn as any });

    const { result } = renderHook(
      () => useDecodedAccount(MOCK_PUBKEY, { coder: mockCoder, accountName: 'TestAccount' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('stays disabled when address is null', () => {
    const { result } = renderHook(
      () => useDecodedAccount(null, { coder: mockCoder, accountName: 'TestAccount' }),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('updates query cache when subscription fires with decodable data', async () => {
    const { captured } = captureSubscribeCallback();
    const coder = { decode: vi.fn().mockReturnValue({ name: 'live' }) } as any;
    const qc = createQueryClient();
    renderHook(
      () => useDecodedAccount(MOCK_PUBKEY, { coder, accountName: 'TestAccount' }),
      { wrapper: createWrapper(qc) },
    );

    act(() => captured.cb?.({ data: Buffer.from([1]), lamports: 1 }));

    expect(coder.decode).toHaveBeenCalledWith('TestAccount', expect.any(Buffer));
    expect(qc.getQueryData(['account-decoded', 'TestAccount', MOCK_PUBKEY.toBase58()])).toEqual({ name: 'live' });
  });

  it('applies transform on subscription update', async () => {
    const { captured } = captureSubscribeCallback();
    const coder = { decode: vi.fn().mockReturnValue({ raw: true }) } as any;
    const transform = vi.fn().mockReturnValue({ transformed: true });
    const qc = createQueryClient();
    renderHook(
      () => useDecodedAccount(MOCK_PUBKEY, { coder, accountName: 'TestAccount', transform }),
      { wrapper: createWrapper(qc) },
    );

    act(() => captured.cb?.({ data: Buffer.from([1]), lamports: 1 }));

    expect(transform).toHaveBeenCalledWith({ raw: true });
    expect(qc.getQueryData(['account-decoded', 'TestAccount', MOCK_PUBKEY.toBase58()])).toEqual({ transformed: true });
  });

  it('swallows decode errors on subscription update', async () => {
    const { captured } = captureSubscribeCallback();
    const coder = { decode: vi.fn().mockImplementation(() => { throw new Error('mid-write'); }) } as any;
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const qc = createQueryClient();
    renderHook(
      () => useDecodedAccount(MOCK_PUBKEY, { coder, accountName: 'TestAccount' }),
      { wrapper: createWrapper(qc) },
    );

    act(() => captured.cb?.({ data: Buffer.from([1]), lamports: 1 }));

    expect(debugSpy).toHaveBeenCalled();
    expect(qc.getQueryData(['account-decoded', 'TestAccount', MOCK_PUBKEY.toBase58()])).toBeUndefined();
    debugSpy.mockRestore();
  });
});

describe('useAnchorAccount', () => {
  const mockProgram = {
    programId: MOCK_PUBKEY,
    coder: { accounts: { decode: vi.fn() } },
    account: {
      testAccount: {
        fetchNullable: vi.fn().mockResolvedValue({ value: 42 }),
      },
    },
  } as any;

  it('fetches via anchor program account accessor', async () => {
    const { result } = renderHook(
      () => useAnchorAccount(mockProgram, 'TestAccount', MOCK_PUBKEY),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockProgram.account.testAccount.fetchNullable).toHaveBeenCalled();
    expect(result.current.data).toEqual({ value: 42 });
  });

  it('stays disabled when program is null', () => {
    const { result } = renderHook(
      () => useAnchorAccount(null, 'TestAccount', MOCK_PUBKEY),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('stays disabled when address is null', () => {
    const { result } = renderHook(
      () => useAnchorAccount(mockProgram, 'TestAccount', null),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('throws for unknown account type', async () => {
    const { result } = renderHook(
      () => useAnchorAccount(mockProgram, 'NoSuchAccount', MOCK_PUBKEY),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/Unknown account type/);
  });

  it('updates query cache when subscription fires with decodable data', async () => {
    const { captured } = captureSubscribeCallback();
    const program = {
      programId: MOCK_PUBKEY,
      coder: { accounts: { decode: vi.fn().mockReturnValue({ live: true }) } },
      account: { testAccount: { fetchNullable: vi.fn() } },
    } as any;
    const qc = createQueryClient();
    renderHook(
      () => useAnchorAccount(program, 'TestAccount', MOCK_PUBKEY),
      { wrapper: createWrapper(qc) },
    );

    act(() => captured.cb?.({ data: Buffer.from([1]), lamports: 1 }));

    expect(program.coder.accounts.decode).toHaveBeenCalledWith('TestAccount', expect.any(Buffer));
    const key = ['anchor-account', MOCK_PUBKEY.toBase58(), 'TestAccount', MOCK_PUBKEY.toBase58()];
    expect(qc.getQueryData(key)).toEqual({ live: true });
  });

  it('swallows decode errors on subscription update', async () => {
    const { captured } = captureSubscribeCallback();
    const program = {
      programId: MOCK_PUBKEY,
      coder: {
        accounts: {
          decode: vi.fn().mockImplementation(() => { throw new Error('mid-write'); }),
        },
      },
      account: { testAccount: { fetchNullable: vi.fn() } },
    } as any;
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const qc = createQueryClient();
    renderHook(
      () => useAnchorAccount(program, 'TestAccount', MOCK_PUBKEY),
      { wrapper: createWrapper(qc) },
    );

    act(() => captured.cb?.({ data: Buffer.from([1]), lamports: 1 }));

    expect(debugSpy).toHaveBeenCalled();
    const key = ['anchor-account', MOCK_PUBKEY.toBase58(), 'TestAccount', MOCK_PUBKEY.toBase58()];
    expect(qc.getQueryData(key)).toBeUndefined();
    debugSpy.mockRestore();
  });
});
