import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { PublicKey } from '@solana/web3.js';
import { useYellowstoneSubscription } from '../hooks/subscription.js';
import { createWrapper, MOCK_PUBKEY, MOCK_PUBKEY_2 } from './helpers.js';

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

describe('useYellowstoneSubscription', () => {
  const config = { endpoint: 'wss://geyser.example.com' };

  it('connects and subscribes to accounts', async () => {
    const { result } = renderHook(
      () => useYellowstoneSubscription({ config, accounts: [MOCK_PUBKEY] }),
      { wrapper: createWrapper() },
    );

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0];

    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));
    const subMsg = JSON.parse(ws.sent[ws.sent.length - 1]);
    expect(subMsg.method).toBe('accountSubscribe');
    expect(subMsg.params.accounts).toContain(MOCK_PUBKEY.toBase58());
  });

  it('authenticates when token is provided', async () => {
    const configWithToken = { endpoint: 'wss://geyser.example.com', token: 'my-token' };

    renderHook(
      () => useYellowstoneSubscription({ config: configWithToken, accounts: [MOCK_PUBKEY] }),
      { wrapper: createWrapper() },
    );

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0];

    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThanOrEqual(2));
    const authMsg = JSON.parse(ws.sent[0]);
    expect(authMsg.method).toBe('authenticate');
    expect(authMsg.params.token).toBe('my-token');
  });

  it('stays disconnected when config is null', () => {
    const { result } = renderHook(
      () => useYellowstoneSubscription({ config: null, accounts: [MOCK_PUBKEY] }),
      { wrapper: createWrapper() },
    );

    expect(MockWebSocket.instances).toHaveLength(0);
    expect(result.current.connected).toBe(false);
  });

  it('stays disconnected when accounts array is empty', () => {
    renderHook(
      () => useYellowstoneSubscription({ config, accounts: [] }),
      { wrapper: createWrapper() },
    );

    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('stays disconnected when enabled=false', () => {
    renderHook(
      () => useYellowstoneSubscription({ config, accounts: [MOCK_PUBKEY], enabled: false }),
      { wrapper: createWrapper() },
    );

    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('calls onUpdate with decoded account data', async () => {
    const onUpdate = vi.fn();

    renderHook(
      () => useYellowstoneSubscription({ config, accounts: [MOCK_PUBKEY], onUpdate }),
      { wrapper: createWrapper() },
    );

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0];

    const encodedData = btoa(String.fromCharCode(1, 2, 3, 4));
    act(() => {
      ws.simulateMessage({
        account: {
          pubkey: MOCK_PUBKEY.toBase58(),
          data: encodedData,
          lamports: '1000000',
        },
        slot: '42',
      });
    });

    expect(onUpdate).toHaveBeenCalledWith(
      expect.any(PublicKey),
      expect.any(Uint8Array),
      42,
      1000000,
    );
    expect(onUpdate.mock.calls[0][1]).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('closes websocket on unmount', async () => {
    const { unmount } = renderHook(
      () => useYellowstoneSubscription({ config, accounts: [MOCK_PUBKEY] }),
      { wrapper: createWrapper() },
    );

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0];

    unmount();
    expect(ws.closed).toBe(true);
  });

  it('unsubscribe() closes the websocket', async () => {
    const { result } = renderHook(
      () => useYellowstoneSubscription({ config, accounts: [MOCK_PUBKEY] }),
      { wrapper: createWrapper() },
    );

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0];

    act(() => { result.current.unsubscribe(); });
    expect(ws.closed).toBe(true);
  });

  it('handles malformed messages gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    renderHook(
      () => useYellowstoneSubscription({ config, accounts: [MOCK_PUBKEY] }),
      { wrapper: createWrapper() },
    );

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.listeners.onmessage?.({ data: 'not-json' });
    });

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
