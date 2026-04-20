import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import {
  fetchBidBook,
  fetchBidsForTask,
  fetchBid,
  fetchAgentByDid,
  buildCommitBidIx,
  buildRevealBidIx,
  buildClaimBondIx,
  taskMarketProgram,
  agentRegistryProgram,
} from '@saep/sdk';
import {
  useBidBook,
  useBidsForTask,
  useBid,
  useBiddingState,
  useTaskBidsIndexed,
  useCommitBid,
  useRevealBid,
  useClaimBond,
} from '../hooks/bids.js';
import {
  createWrapper,
  createQueryClient,
  mockConnection,
  mockWallet,
  mockAnchorWallet,
  MOCK_PUBKEY,
  MOCK_PUBKEY_2,
} from './helpers.js';

const mockTm = { programId: MOCK_PUBKEY } as any;
const mockAr = { programId: MOCK_PUBKEY_2 } as any;
const validHex = 'd'.repeat(64);

const dummyIx = new TransactionInstruction({
  keys: [],
  programId: MOCK_PUBKEY,
  data: Buffer.from([]),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockConnection();
  mockAnchorWallet();
  vi.mocked(taskMarketProgram).mockReturnValue(mockTm);
  vi.mocked(agentRegistryProgram).mockReturnValue(mockAr);
});

describe('useBidBook', () => {
  it('fetches bid book for valid task hex', async () => {
    const book = { bids: [{ amount: 100 }] };
    vi.mocked(fetchBidBook).mockResolvedValue(book as any);

    const { result } = renderHook(() => useBidBook(validHex), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchBidBook).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(fetchBidBook).mock.calls[0];
    expect(callArgs[0]).toBe(mockTm);
    // second arg is Uint8Array from hexToBytes
    expect(callArgs[1]).toBeInstanceOf(Uint8Array);
    expect(result.current.data).toEqual(book);
  });

  it('stays disabled for null', () => {
    const { result } = renderHook(() => useBidBook(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('stays disabled for short hex', () => {
    const { result } = renderHook(() => useBidBook('abc'), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useBidsForTask', () => {
  it('fetches bids for a task', async () => {
    const bids = [{ bidder: 'x' }];
    vi.mocked(fetchBidsForTask).mockResolvedValue(bids as any);

    const { result } = renderHook(() => useBidsForTask(validHex), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(bids);
  });
});

describe('useBid', () => {
  it('fetches single bid for task + bidder', async () => {
    const bid = { amount: 50 };
    vi.mocked(fetchBid).mockResolvedValue(bid as any);

    const { result } = renderHook(() => useBid(validHex, MOCK_PUBKEY), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchBid).toHaveBeenCalledTimes(1);
  });

  it('stays disabled when bidder is null', () => {
    const { result } = renderHook(() => useBid(validHex, null), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useBiddingState', () => {
  const indexerUrl = 'https://idx.example.com';
  const rawSnake = {
    task_id_hex: validHex,
    phase: 'commit' as const,
    commit_count: 3,
    reveal_count: 1,
    slashed_count: 0,
    bond_amount: '1000000',
    commit_end_unix: 1700000000,
    reveal_end_unix: 1700003600,
    winner_agent: null,
    winner_bidder: null,
    winner_amount: null,
  };

  it('transforms snake_case indexer payload into camelCase state', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => rawSnake,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useBiddingState(indexerUrl, validHex), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe(`${indexerUrl}/tasks/${validHex}/bidding`);
    expect(result.current.data).toEqual({
      taskIdHex: validHex,
      phase: 'commit',
      commitCount: 3,
      revealCount: 1,
      slashedCount: 0,
      bondAmount: '1000000',
      commitEndUnix: 1700000000,
      revealEndUnix: 1700003600,
      winnerAgent: null,
      winnerBidder: null,
      winnerAmount: null,
    });
    vi.unstubAllGlobals();
  });

  it('strips trailing slash from indexerUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => rawSnake,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(
      () => useBiddingState(`${indexerUrl}/`, validHex),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe(`${indexerUrl}/tasks/${validHex}/bidding`);
    vi.unstubAllGlobals();
  });

  it('surfaces indexer error body on non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => 'indexer restarting',
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useBiddingState(indexerUrl, validHex), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('indexer 503: indexer restarting');
    vi.unstubAllGlobals();
  });

  it('falls back to statusText when response body is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useBiddingState(indexerUrl, validHex), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('indexer 500: Internal Server Error');
    vi.unstubAllGlobals();
  });

  it('stays disabled for null task hex', () => {
    const { result } = renderHook(() => useBiddingState(indexerUrl, null), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('stays disabled for short task hex', () => {
    const { result } = renderHook(() => useBiddingState(indexerUrl, 'abc'), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useTaskBidsIndexed', () => {
  const indexerUrl = 'https://idx.example.com';

  it('maps raw snake_case bid rows into camelCase records', async () => {
    const rawRows = [
      {
        bidder: MOCK_PUBKEY.toBase58(),
        bond_paid: '500000',
        revealed_amount: '2000000',
        slashed: false,
      },
      {
        bidder: MOCK_PUBKEY_2.toBase58(),
        bond_paid: null,
        revealed_amount: null,
        slashed: true,
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => rawRows,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(
      () => useTaskBidsIndexed(indexerUrl, validHex),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe(`${indexerUrl}/tasks/${validHex}/bids`);
    expect(result.current.data).toEqual([
      {
        bidder: MOCK_PUBKEY.toBase58(),
        bondPaid: '500000',
        revealedAmount: '2000000',
        slashed: false,
      },
      {
        bidder: MOCK_PUBKEY_2.toBase58(),
        bondPaid: null,
        revealedAmount: null,
        slashed: true,
      },
    ]);
    vi.unstubAllGlobals();
  });

  it('stays disabled for null task hex', () => {
    const { result } = renderHook(
      () => useTaskBidsIndexed(indexerUrl, null),
      { wrapper: createWrapper() },
    );
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useCommitBid', () => {
  const commitArgs = {
    task: MOCK_PUBKEY,
    taskId: new Uint8Array(32),
    paymentMint: MOCK_PUBKEY_2,
    bidderTokenAccount: MOCK_PUBKEY,
    agentDidHex: 'e'.repeat(64),
    commitHash: new Uint8Array(32),
  };

  it('validates operator ownership before committing', async () => {
    mockWallet();
    vi.mocked(fetchAgentByDid).mockResolvedValue({
      operator: MOCK_PUBKEY,
      agentId: new Uint8Array(32),
    } as any);
    vi.mocked(buildCommitBidIx).mockResolvedValue(dummyIx);
    const qc = createQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useCommitBid(), {
      wrapper: createWrapper(qc),
    });

    act(() => {
      result.current.mutate(commitArgs);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchAgentByDid).toHaveBeenCalledWith(mockAr, commitArgs.agentDidHex);
    expect(buildCommitBidIx).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bid-book'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bids-for-task'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bid'] });
  });

  it('rejects if agent not found', async () => {
    mockWallet();
    vi.mocked(fetchAgentByDid).mockResolvedValue(null as any);

    const { result } = renderHook(() => useCommitBid(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(commitArgs);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain('agent_did not registered');
  });

  it('rejects if wallet is not the operator', async () => {
    mockWallet();
    const otherKey = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    vi.mocked(fetchAgentByDid).mockResolvedValue({
      operator: otherKey,
      agentId: new Uint8Array(32),
    } as any);

    const { result } = renderHook(() => useCommitBid(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(commitArgs);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain('not the registered operator');
  });
});

describe('useRevealBid', () => {
  it('sends reveal tx and invalidates bid caches', async () => {
    const conn = mockConnection();
    const wallet = mockWallet();
    vi.mocked(buildRevealBidIx).mockResolvedValue(dummyIx);
    const qc = createQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useRevealBid(), {
      wrapper: createWrapper(qc),
    });

    act(() => {
      result.current.mutate({
        task: MOCK_PUBKEY,
        taskId: new Uint8Array(32),
        amount: BigInt(1_000_000),
        nonce: new Uint8Array(16),
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(buildRevealBidIx).toHaveBeenCalledTimes(1);
    expect(wallet.sendTransaction).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bid-book'] });
  });

  it('errors when wallet missing', async () => {
    mockWallet({ publicKey: null });

    const { result } = renderHook(() => useRevealBid(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({
        task: MOCK_PUBKEY,
        taskId: new Uint8Array(32),
        amount: BigInt(100),
        nonce: new Uint8Array(16),
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Missing wallet publicKey');
  });
});

describe('useClaimBond', () => {
  it('sends claim tx and invalidates bid cache', async () => {
    mockConnection();
    mockWallet();
    vi.mocked(buildClaimBondIx).mockResolvedValue(dummyIx);
    const qc = createQueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useClaimBond(), {
      wrapper: createWrapper(qc),
    });

    act(() => {
      result.current.mutate({
        task: MOCK_PUBKEY,
        taskId: new Uint8Array(32),
        paymentMint: MOCK_PUBKEY_2,
        bidderTokenAccount: MOCK_PUBKEY,
        feeCollectorTokenAccount: MOCK_PUBKEY_2,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(buildClaimBondIx).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bid'] });
  });
});
