'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export interface StatusChangeMessage {
  type: 'status_change';
  agent: {
    did: string;
    status: string;
    reputation: number;
    last_active_unix: number;
  };
}

export interface NewTaskMessage {
  type: 'new_task';
  task: {
    task_id: string;
    creator: string | null;
    status: string | null;
    reward_lamports: string | null;
    created_at_unix: number;
    deadline_unix: number;
  };
}

export type DiscoveryStreamMessage = StatusChangeMessage | NewTaskMessage;

export type DiscoveryEventType = 'status_change' | 'new_task';

export interface UseDiscoveryStreamOptions {
  url: string | null;
  capabilities?: number[];
  events?: DiscoveryEventType[];
  enabled?: boolean;
  onMessage?: (msg: DiscoveryStreamMessage) => void;
  invalidateLeaderboard?: boolean;
  invalidateTaskLists?: boolean;
}

function toWsUrl(httpUrl: string): string {
  if (httpUrl.startsWith('ws://') || httpUrl.startsWith('wss://')) return httpUrl;
  if (httpUrl.startsWith('https://')) return `wss://${httpUrl.slice('https://'.length)}/ws`;
  if (httpUrl.startsWith('http://')) return `ws://${httpUrl.slice('http://'.length)}/ws`;
  return httpUrl;
}

export function useDiscoveryStream(opts: UseDiscoveryStreamOptions) {
  const {
    url,
    capabilities,
    events,
    enabled = true,
    onMessage,
    invalidateLeaderboard = true,
    invalidateTaskLists = false,
  } = opts;
  const qc = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const capabilitiesKey = capabilities ? capabilities.slice().sort((a, b) => a - b).join(',') : '';
  const eventsKey = events ? events.slice().sort().join(',') : '';

  useEffect(() => {
    if (!url || !enabled) return;

    const ws = new WebSocket(toWsUrl(url));
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          ...(capabilities ? { capabilities } : {}),
          ...(events ? { events } : {}),
        }),
      );
    };

    ws.onmessage = (event) => {
      let msg: DiscoveryStreamMessage;
      try {
        const parsed = JSON.parse(event.data as string);
        if (parsed.type !== 'status_change' && parsed.type !== 'new_task') return;
        msg = parsed as DiscoveryStreamMessage;
      } catch {
        return;
      }

      if (msg.type === 'status_change') {
        if (invalidateLeaderboard) {
          qc.invalidateQueries({ queryKey: ['leaderboard'] });
          qc.invalidateQueries({ queryKey: ['agent-reputation', msg.agent.did] });
        }
      }
      if (msg.type === 'new_task' && invalidateTaskLists) {
        qc.invalidateQueries({ queryKey: ['discovery-tasks'] });
        qc.invalidateQueries({ queryKey: ['task-list'] });
      }

      onMessageRef.current?.(msg);
    };

    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    return () => {
      ws.close();
      wsRef.current = null;
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, enabled, capabilitiesKey, eventsKey, qc, invalidateLeaderboard, invalidateTaskLists]);

  return { connected };
}
