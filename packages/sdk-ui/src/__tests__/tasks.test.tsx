import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { useAnchorWallet } from '@solana/wallet-adapter-react';
import {
  fetchMarketGlobal,
  fetchRecentTasks,
  fetchTaskById,
  fetchTasksByClient,
  buildRaiseDisputeIx,
  taskMarketProgram,
} from '@saep/sdk';
import {
  useTask,
  useTasksByClient,
  useRaiseDispute,
  useDiscoveryTasks,
  useDiscoveryAgentTasks,
  useDiscoveryTaskMatches,
  useTaskComputeBonds,
  useRecentTasks,
  useTaskMarketConfig,
} from '../hooks/tasks.js';
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

afterEach(() => {
  vi.unstubAllGlobals();
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

describe('discovery task hooks', () => {
  const INDEXER = 'https://idx.example.com';
  const taskIdHex = 'a'.repeat(64);
  const agentDidHex = 'b'.repeat(64);

  it('maps indexed task rows with compute bond summaries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              task_id_hex: taskIdHex,
              creator: 'creator-1',
              agent_did_hex: agentDidHex,
              status: 'inExecution',
              reward_lamports: '900000000',
              capability_mask: '5',
              created_at_unix: 1700000000,
              deadline_unix: 1700003600,
              updated_at_unix: 1700001800,
              compute_bonds: [
                {
                  lease_id: 'ionet-lease-1',
                  agent_did: 'agent-did-1',
                  provider: 'ionet',
                  gpu_hours: 12,
                  expires_at: 1700007200,
                  slashable_until: 1700010800,
                  task_id: taskIdHex,
                  status: 'locked',
                  status_reason: null,
                  reserved_price_usd_micro: 50000000,
                  broker_pubkey: 'broker-pubkey',
                  attestation_sig: 'attestation',
                  created_at_ms: 1700000000000,
                  updated_at_ms: 1700001200000,
                  provider_status: 'active',
                },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(
      () =>
        useDiscoveryTasks({ indexerUrl: INDEXER, statuses: ['funded', 'inExecution'], limit: 10 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${INDEXER}/tasks?status=funded%2CinExecution&page=1&limit=10`,
    );
    expect(result.current.data).toEqual([
      {
        taskIdHex,
        creator: 'creator-1',
        agentDidHex,
        status: 'inExecution',
        rewardLamports: '900000000',
        capabilityMask: '5',
        createdAtUnix: 1700000000,
        deadlineUnix: 1700003600,
        updatedAtUnix: 1700001800,
        computeBonds: [
          {
            leaseId: 'ionet-lease-1',
            agentDid: 'agent-did-1',
            provider: 'ionet',
            gpuHours: 12,
            expiresAt: 1700007200,
            slashableUntil: 1700010800,
            taskId: taskIdHex,
            status: 'locked',
            statusReason: null,
            reservedPriceUsdMicro: 50000000,
            brokerPubkey: 'broker-pubkey',
            attestationSig: 'attestation',
            createdAtMs: 1700000000000,
            updatedAtMs: 1700001200000,
            providerStatus: 'active',
          },
        ],
      },
    ]);
  });

  it('fetches indexed agent task history when the did is valid', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              task_id: taskIdHex,
              creator: 'creator-2',
              status: 'verified',
              reward_lamports: '700000000',
              created_at_unix: 1700000001,
              deadline_unix: 1700003601,
              updated_at_unix: 1700001801,
              compute_bonds: [],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(
      () => useDiscoveryAgentTasks({ indexerUrl: `${INDEXER}/`, agentDidHex, limit: 5 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${INDEXER}/agents/${agentDidHex}/tasks?page=1&limit=5`,
    );
    expect(result.current.data?.[0]?.taskIdHex).toBe(taskIdHex);
  });

  it('fetches dedicated task compute bonds and stays disabled for invalid task ids', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              lease_id: 'akash-lease-2',
              agent_did: 'agent-did-2',
              provider: 'akash',
              gpu_hours: 24,
              expires_at: 1700010000,
              slashable_until: 1700013600,
              task_id: taskIdHex,
              status: 'slashed',
              status_reason: 'missed deadline',
              reserved_price_usd_micro: 90000000,
              broker_pubkey: 'broker-2',
              attestation_sig: 'sig-2',
              created_at_ms: 1700000100000,
              updated_at_ms: 1700000200000,
              provider_status: 'reclaimed',
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(
      () =>
        useTaskComputeBonds({
          indexerUrl: INDEXER,
          taskIdHex,
          status: 'slashed',
          provider: 'akash',
          limit: 2,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${INDEXER}/tasks/${taskIdHex}/compute-bonds?status=slashed&provider=akash&limit=2`,
    );
    expect(result.current.data?.[0]).toMatchObject({
      leaseId: 'akash-lease-2',
      status: 'slashed',
      providerStatus: 'reclaimed',
    });

    const disabled = renderHook(
      () => useTaskComputeBonds({ indexerUrl: INDEXER, taskIdHex: 'short' }),
      { wrapper: createWrapper() },
    );
    expect(disabled.result.current.fetchStatus).toBe('idle');
  });

  it('fetches ranked task matches for one indexed task', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          task_id_hex: taskIdHex,
          task_status: 'funded',
          capability_bit: 2,
          items: [
            {
              did_hex: agentDidHex,
              operator: 'operator-1',
              capability_mask: '4',
              stake_lamports: '1100000000',
              reputation_composite: 5300,
              status: 'active',
              last_active_unix: 1700000200,
              match_summary: {
                required_capability_bits: [2],
                matched_capability_bits: [2],
                missing_capability_bits: [],
                coverage_bps: 10000,
                fit_score: 5900,
                base_fit_score_bps: 6400,
                capability_reputation_composite: 5750,
                availability: 5400,
                cost_efficiency: 5200,
                honesty: 7000,
                jobs_completed: 15,
                jobs_disputed: 0,
                confidence_bps: 7500,
                dispute_rate_bps: 0,
                low_history: false,
                low_confidence: false,
                availability_warning: true,
                dispute_warning: false,
                trust_state: 'watch',
                low_history_penalty_bps: 600,
                dispute_penalty_bps: 0,
                availability_penalty_bps: 800,
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(
      () => useDiscoveryTaskMatches({ indexerUrl: INDEXER, taskIdHex, limit: 3 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${INDEXER}/v1/discovery/tasks/${taskIdHex}/matches?limit=3`,
    );
    expect(result.current.data).toEqual({
      taskIdHex,
      taskStatus: 'funded',
      capabilityBit: 2,
      items: [
        {
          didHex: agentDidHex,
          operator: 'operator-1',
          capabilityMask: '4',
          stakeLamports: '1100000000',
          reputationComposite: 5300,
          status: 'active',
          lastActiveUnix: 1700000200,
          matchSummary: {
            requiredCapabilityBits: [2],
            matchedCapabilityBits: [2],
            missingCapabilityBits: [],
            coverageBps: 10000,
            fitScore: 5900,
            baseFitScoreBps: 6400,
            capabilityReputationComposite: 5750,
            availability: 5400,
            costEfficiency: 5200,
            honesty: 7000,
            jobsCompleted: 15,
            jobsDisputed: 0,
            confidenceBps: 7500,
            disputeRateBps: 0,
            lowHistory: false,
            lowConfidence: false,
            availabilityWarning: true,
            disputeWarning: false,
            trustState: 'watch',
            lowHistoryPenaltyBps: 600,
            disputePenaltyBps: 0,
            availabilityPenaltyBps: 800,
          },
        },
      ],
    });
  });

  it('uses default discovery query params and falls back cleanly when ids or fetch bodies are invalid', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                creator: 'creator-3',
                status: 'funded',
                reward_lamports: '1',
                created_at_unix: 1,
                deadline_unix: null,
                updated_at_unix: null,
                compute_bonds: [],
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: vi.fn().mockRejectedValue(new Error('body unavailable')),
      });
    vi.stubGlobal('fetch', fetchMock);

    const tasks = renderHook(() => useDiscoveryTasks({ indexerUrl: `${INDEXER}/` }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(tasks.result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${INDEXER}/tasks?page=1&limit=20`);
    expect(tasks.result.current.data?.[0]).toMatchObject({
      taskIdHex: '',
      agentDidHex: null,
      capabilityMask: null,
    });

    const errored = renderHook(
      () =>
        useDiscoveryTasks({ indexerUrl: INDEXER, capability: 0, minReward: '0', enabled: true }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(errored.result.current.isError).toBe(true));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `${INDEXER}/tasks?capability=0&min_reward=0&page=1&limit=20`,
    );
    expect(errored.result.current.error?.message).toBe('indexer 503: Service Unavailable');

    const invalidDid = renderHook(
      () =>
        useDiscoveryAgentTasks({ indexerUrl: INDEXER, agentDidHex: 'too-short', enabled: true }),
      { wrapper: createWrapper() },
    );
    expect(invalidDid.result.current.fetchStatus).toBe('idle');
  });
});

describe('task market read hooks', () => {
  it('fetches recent tasks and config when the program is available', async () => {
    vi.mocked(fetchRecentTasks).mockResolvedValue([{ id: 'recent-1' }] as any);
    vi.mocked(fetchMarketGlobal).mockResolvedValue({ feeBps: 25 } as any);

    const recent = renderHook(() => useRecentTasks(5, ['open', 'funded']), {
      wrapper: createWrapper(),
    });
    const config = renderHook(() => useTaskMarketConfig(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(recent.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(config.result.current.isSuccess).toBe(true));

    expect(fetchRecentTasks).toHaveBeenCalledWith(mockProgramInstance, {
      limit: 5,
      statuses: ['open', 'funded'],
    });
    expect(fetchMarketGlobal).toHaveBeenCalledWith(mockProgramInstance);
  });

  it('keeps recent-tasks and config queries idle when the program is unavailable', () => {
    vi.mocked(taskMarketProgram).mockReturnValue(null as any);

    const recent = renderHook(() => useRecentTasks(), {
      wrapper: createWrapper(),
    });
    const config = renderHook(() => useTaskMarketConfig(), {
      wrapper: createWrapper(),
    });

    expect(recent.result.current.fetchStatus).toBe('idle');
    expect(config.result.current.fetchStatus).toBe('idle');
    expect(fetchRecentTasks).not.toHaveBeenCalled();
    expect(fetchMarketGlobal).not.toHaveBeenCalled();
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

  it('errors when program is available but wallet publicKey is missing', async () => {
    mockWallet({ publicKey: null });

    const { result } = renderHook(() => useRaiseDispute(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate(MOCK_PUBKEY);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Missing wallet publicKey');
    expect(buildRaiseDisputeIx).not.toHaveBeenCalled();
  });
});
