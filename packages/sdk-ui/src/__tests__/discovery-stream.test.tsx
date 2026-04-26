import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDiscoveryStream } from '../hooks/discovery-stream.js';
import { createQueryClient, createWrapper } from './helpers.js';

type WsListener = Record<string, Function>;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  listeners: WsListener = {};
  sent: string[] = [];
  closed = false;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    setTimeout(() => this.listeners.onopen?.(), 0);
  }

  set onopen(fn: Function) { this.listeners.onopen = fn; }
  set onmessage(fn: Function) { this.listeners.onmessage = fn; }
  set onclose(fn: Function) { this.listeners.onclose = fn; }
  set onerror(fn: Function) { this.listeners.onerror = fn; }

  send(data: string) { this.sent.push(data); }
  close() {
    this.closed = true;
    this.listeners.onclose?.();
  }

  simulateMessage(data: unknown) {
    this.listeners.onmessage?.({ data: JSON.stringify(data) });
  }
}

let originalWebSocket: typeof WebSocket;

beforeEach(() => {
  vi.clearAllMocks();
  MockWebSocket.instances = [];
  originalWebSocket = globalThis.WebSocket;
  (globalThis as any).WebSocket = MockWebSocket;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
});

describe('useDiscoveryStream', () => {
  it('opens a WS connection and sends subscribe with capabilities + events', async () => {
    const { wrapper } = makeWrapper();
    renderHook(
      () => useDiscoveryStream({
        url: 'http://discovery.local',
        capabilities: [2, 5],
        events: ['status_change'],
      }),
      { wrapper },
    );

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0];
    expect(ws.url).toBe('ws://discovery.local/ws');

    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));
    const sub = JSON.parse(ws.sent[0]);
    expect(sub).toEqual({
      type: 'subscribe',
      capabilities: [2, 5],
      events: ['status_change'],
    });
  });

  it('upgrades https → wss', async () => {
    const { wrapper } = makeWrapper();
    renderHook(
      () => useDiscoveryStream({ url: 'https://disc.example.com' }),
      { wrapper },
    );
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    expect(MockWebSocket.instances[0].url).toBe('wss://disc.example.com/ws');
  });

  it('stays disconnected when url is null', () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useDiscoveryStream({ url: null }),
      { wrapper },
    );
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(result.current.connected).toBe(false);
  });

  it('stays disconnected when enabled=false', () => {
    const { wrapper } = makeWrapper();
    renderHook(
      () => useDiscoveryStream({ url: 'http://x.local', enabled: false }),
      { wrapper },
    );
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('invalidates leaderboard + agent-reputation on status_change', async () => {
    const { wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');

    renderHook(
      () => useDiscoveryStream({ url: 'http://x.local', events: ['status_change'] }),
      { wrapper },
    );

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.simulateMessage({
        type: 'status_change',
        agent: {
          did: 'a'.repeat(64),
          status: 'active',
          reputation: 7500,
          last_active_unix: 1_700_000_000,
        },
      });
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['leaderboard'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['agent-reputation', 'a'.repeat(64)] });
  });

  it('does not invalidate task lists by default on new_task', async () => {
    const { wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');

    renderHook(
      () => useDiscoveryStream({ url: 'http://x.local', events: ['new_task'] }),
      { wrapper },
    );

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.simulateMessage({
        type: 'new_task',
        task: {
          task_id: 't',
          creator: null,
          status: 'open',
          reward_lamports: '0',
          created_at_unix: 1,
          deadline_unix: 2,
        },
      });
    });

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('opts in to task-list invalidation when invalidateTaskLists=true', async () => {
    const { wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');

    renderHook(
      () => useDiscoveryStream({
        url: 'http://x.local',
        events: ['new_task'],
        invalidateTaskLists: true,
        invalidateLeaderboard: false,
      }),
      { wrapper },
    );

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.simulateMessage({
        type: 'new_task',
        task: {
          task_id: 't',
          creator: null,
          status: 'open',
          reward_lamports: '0',
          created_at_unix: 1,
          deadline_unix: 2,
        },
      });
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['discovery-tasks'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['task-list'] });
  });

  it('forwards task_released frames and invalidates task lists when opted in', async () => {
    const { wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const onMessage = vi.fn();

    renderHook(
      () => useDiscoveryStream({
        url: 'http://x.local',
        events: ['task_released'],
        invalidateTaskLists: true,
        invalidateLeaderboard: false,
        onMessage,
      }),
      { wrapper },
    );

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.simulateMessage({
        type: 'task_released',
        task: {
          task_id: 't1',
          creator: 'creator-pk',
          agent_did: 'a'.repeat(64),
          status: 'released',
          reward_lamports: '1000000',
          updated_at_unix: 1_700_000_500,
        },
      });
    });

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0].type).toBe('task_released');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['discovery-tasks'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['task-list'] });
  });

  it('forwards task_disputed frames without invalidating task lists by default', async () => {
    const { wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const onMessage = vi.fn();

    renderHook(
      () => useDiscoveryStream({
        url: 'http://x.local',
        events: ['task_disputed'],
        onMessage,
      }),
      { wrapper },
    );

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.simulateMessage({
        type: 'task_disputed',
        task: {
          task_id: 't2',
          creator: null,
          agent_did: null,
          status: 'disputed',
          reward_lamports: null,
          updated_at_unix: 1_700_000_900,
        },
      });
    });

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0].type).toBe('task_disputed');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('forwards parsed messages to onMessage', async () => {
    const { wrapper } = makeWrapper();
    const onMessage = vi.fn();

    renderHook(
      () => useDiscoveryStream({ url: 'http://x.local', onMessage }),
      { wrapper },
    );

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.simulateMessage({
        type: 'status_change',
        agent: { did: 'd', status: 'active', reputation: 1, last_active_unix: 1 },
      });
    });

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0].type).toBe('status_change');
  });

  it('ignores unknown message types', async () => {
    const { wrapper } = makeWrapper();
    const onMessage = vi.fn();

    renderHook(
      () => useDiscoveryStream({ url: 'http://x.local', onMessage }),
      { wrapper },
    );

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.simulateMessage({ type: 'subscribed', capabilities: null, events: null });
    });
    act(() => {
      ws.listeners.onmessage?.({ data: 'not-json' });
    });

    expect(onMessage).not.toHaveBeenCalled();
  });

  it('closes the socket on unmount', async () => {
    const { wrapper } = makeWrapper();
    const { unmount } = renderHook(
      () => useDiscoveryStream({ url: 'http://x.local' }),
      { wrapper },
    );
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0];
    unmount();
    expect(ws.closed).toBe(true);
  });
});

function makeWrapper() {
  const qc = createQueryClient();
  const wrapper = createWrapper(qc);
  return { wrapper, qc };
}
