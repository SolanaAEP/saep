import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { PublicKey } from '@solana/web3.js';
import {
  fetchAgentsByOperator,
  fetchAgentByDid,
  fetchAllAgentsDetailed,
  agentRegistryProgram,
  taskMarketProgram,
  treasuryStandardProgram,
  fetchTasksByAgent,
  fetchTreasury,
} from '@saep/sdk';
import { useAnchorWallet, useConnection } from '@solana/wallet-adapter-react';
import { useAgentsByOperator, useAgent, useAllAgents, useAgentTasks, useTreasury } from '../hooks/agents.js';
import { createWrapper, MOCK_PUBKEY, mockAnchorWallet, mockConnection } from './helpers.js';

const mockProgramInstance = { programId: MOCK_PUBKEY } as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockConnection();
  mockAnchorWallet();
  vi.mocked(agentRegistryProgram).mockReturnValue(mockProgramInstance);
  vi.mocked(taskMarketProgram).mockReturnValue(mockProgramInstance);
  vi.mocked(treasuryStandardProgram).mockReturnValue(mockProgramInstance);
});

describe('useAgentsByOperator', () => {
  it('fetches agents for a given operator', async () => {
    const agents = [{ did: 'abc', name: 'Agent1' }];
    vi.mocked(fetchAgentsByOperator).mockResolvedValue(agents as any);

    const { result } = renderHook(() => useAgentsByOperator(MOCK_PUBKEY), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchAgentsByOperator).toHaveBeenCalledWith(mockProgramInstance, MOCK_PUBKEY);
    expect(result.current.data).toEqual(agents);
  });

  it('stays disabled when operator is null', () => {
    const { result } = renderHook(() => useAgentsByOperator(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchAgentsByOperator).not.toHaveBeenCalled();
  });

  it('propagates fetch errors', async () => {
    vi.mocked(fetchAgentsByOperator).mockRejectedValue(new Error('rpc down'));

    const { result } = renderHook(() => useAgentsByOperator(MOCK_PUBKEY), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('rpc down');
  });
});

describe('useAgent', () => {
  const validHex = 'a'.repeat(64);

  it('fetches an agent by DID hex', async () => {
    const agent = { did: validHex, name: 'Test' };
    vi.mocked(fetchAgentByDid).mockResolvedValue(agent as any);

    const { result } = renderHook(() => useAgent(validHex), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchAgentByDid).toHaveBeenCalledWith(mockProgramInstance, validHex);
    expect(result.current.data).toEqual(agent);
  });

  it('stays disabled for null didHex', () => {
    const { result } = renderHook(() => useAgent(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('stays disabled for invalid-length didHex', () => {
    const { result } = renderHook(() => useAgent('too-short'), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useAllAgents', () => {
  it('fetches all agents', async () => {
    const agents = [{ did: 'a', name: 'A' }, { did: 'b', name: 'B' }];
    vi.mocked(fetchAllAgentsDetailed).mockResolvedValue(agents as any);

    const { result } = renderHook(() => useAllAgents(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchAllAgentsDetailed).toHaveBeenCalledWith(mockProgramInstance);
    expect(result.current.data).toEqual(agents);
  });

  it('stays disabled when wallet not connected', () => {
    vi.mocked(useAnchorWallet).mockReturnValue(undefined as any);

    const { result } = renderHook(() => useAllAgents(), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useAgentTasks', () => {
  const validHex = 'b'.repeat(64);

  it('fetches tasks for an agent', async () => {
    const tasks = [{ id: '1' }];
    vi.mocked(fetchTasksByAgent).mockResolvedValue(tasks as any);

    const { result } = renderHook(() => useAgentTasks(validHex), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchTasksByAgent).toHaveBeenCalledWith(mockProgramInstance, validHex);
  });
});

describe('useTreasury', () => {
  it('fetches treasury for agent DID bytes', async () => {
    const treasury = { balance: 1000 };
    vi.mocked(fetchTreasury).mockResolvedValue(treasury as any);
    const did = new Uint8Array(32).fill(0xab);

    const { result } = renderHook(() => useTreasury(did), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchTreasury).toHaveBeenCalledWith(mockProgramInstance, did);
  });

  it('stays disabled when agentDid is null', () => {
    const { result } = renderHook(() => useTreasury(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });
});
