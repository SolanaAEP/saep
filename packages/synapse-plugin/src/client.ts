import type {
  SynapseClient,
  SynapseClientOptions,
  SynapseRpcClient,
  SynapseWsClient,
  SynapseAgentConfig,
} from './synapse-types.js';

export function createSynapseClient(opts: SynapseClientOptions): SynapseClient {
  const rpc = createRpcClient(opts.rpcUrl, opts.apiKey);
  const ws = createWsClient(opts);

  return {
    rpc,
    ws,
    async registerAgent(config: SynapseAgentConfig) {
      return rpc.call<{ registered: boolean; sessionId: string }>('agent.register', config);
    },
    async close() {
      ws.unsubscribe('*');
    },
  };
}

function createRpcClient(rpcUrl: string, apiKey?: string): SynapseRpcClient {
  let nextId = 1;

  const headers = (extra?: Record<string, string>): Record<string, string> => {
    const h: Record<string, string> = { 'content-type': 'application/json', ...extra };
    if (apiKey) h['x-api-key'] = apiKey;
    return h;
  };

  return {
    async call<T = unknown>(method: string, params?: unknown): Promise<T> {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
      });

      if (!response.ok) {
        throw new Error(`synapse rpc failed: ${response.status} ${response.statusText}`);
      }

      const body = (await response.json()) as {
        result?: T;
        error?: { code: number; message: string };
      };
      if (body.error) {
        throw new Error(`synapse rpc error ${body.error.code}: ${body.error.message}`);
      }
      return body.result as T;
    },

    // fire-and-forget — network errors intentionally dropped
    notify(method: string, params?: unknown) {
      fetch(rpcUrl, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ jsonrpc: '2.0', method, params }),
      }).catch(() => {});
    },
  };
}

function createWsClient(opts: SynapseClientOptions): SynapseWsClient {
  const wsUrl = opts.wsUrl ?? opts.rpcUrl.replace(/^http/, 'ws');
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  let ws: WebSocket | null = null;
  let reconnectAttempts = 0;
  const maxAttempts = opts.maxReconnectAttempts ?? 10;
  const interval = opts.reconnectIntervalMs ?? 3000;

  function connect() {
    if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      reconnectAttempts = 0;
      for (const channel of listeners.keys()) {
        ws!.send(JSON.stringify({ type: 'subscribe', channel }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as { channel?: string; data?: unknown };
        if (msg.channel) {
          const cbs = listeners.get(msg.channel);
          if (cbs) for (const cb of cbs) cb(msg.data);
        }
      } catch (err) {
        console.error('[synapse-ws] message parse error:', err);
      }
    };

    ws.onclose = () => {
      if (reconnectAttempts < maxAttempts) {
        reconnectAttempts++;
        setTimeout(connect, interval * reconnectAttempts);
      }
    };

    ws.onerror = () => ws?.close();
  }

  return {
    subscribe(channel: string, handler: (data: unknown) => void): () => void {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(handler);

      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'subscribe', channel }));
      } else {
        connect();
      }

      return () => {
        listeners.get(channel)?.delete(handler);
        if (listeners.get(channel)?.size === 0) {
          listeners.delete(channel);
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'unsubscribe', channel }));
          }
        }
      };
    },

    unsubscribe(channel: string) {
      if (channel === '*') {
        listeners.clear();
        ws?.close();
        ws = null;
      } else {
        listeners.delete(channel);
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'unsubscribe', channel }));
        }
      }
    },

    connected() {
      return ws?.readyState === WebSocket.OPEN;
    },

    async reconnect() {
      ws?.close();
      ws = null;
      reconnectAttempts = 0;
      connect();
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            clearInterval(check);
            resolve();
          }
        }, 500);
        setTimeout(() => {
          clearInterval(check);
          resolve();
        }, interval * 3);
      });
    },
  };
}

export function isSynapseClient(v: unknown): v is SynapseClient {
  return typeof v === 'object' && v !== null && 'rpc' in v && 'ws' in v;
}
