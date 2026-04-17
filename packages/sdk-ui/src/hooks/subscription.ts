'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PublicKey } from '@solana/web3.js';

export interface YellowstoneConfig {
  endpoint: string;
  token?: string;
}

export type AccountUpdateHandler = (
  pubkey: PublicKey,
  data: Uint8Array,
  slot: number,
  lamports: number,
) => void;

export interface UseYellowstoneSubscriptionOptions {
  config: YellowstoneConfig | null;
  accounts: PublicKey[];
  enabled?: boolean;
  onUpdate?: AccountUpdateHandler;
}

interface GeyserAccountUpdate {
  account?: {
    pubkey: string;
    data: string;
    lamports: string;
  };
  slot?: string;
}

export function useYellowstoneSubscription(opts: UseYellowstoneSubscriptionOptions) {
  const { config, accounts, enabled = true, onUpdate } = opts;
  const qc = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const accountKeys = accounts.map((a) => a.toBase58()).sort().join(',');

  useEffect(() => {
    if (!config || !enabled || accounts.length === 0) return;

    const ws = new WebSocket(config.endpoint);
    wsRef.current = ws;

    ws.onopen = () => {
      if (config.token) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'authenticate', params: { token: config.token } }));
      }
      setConnected(true);
      const subscribe = {
        jsonrpc: '2.0',
        id: 1,
        method: 'accountSubscribe',
        params: {
          accounts: accounts.map((a) => a.toBase58()),
          commitment: 'confirmed',
          encoding: 'base64',
        },
      };
      ws.send(JSON.stringify(subscribe));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as GeyserAccountUpdate;
        if (!msg.account) return;
        const pubkey = new PublicKey(msg.account.pubkey);
        const data = Uint8Array.from(atob(msg.account.data), (c) => c.charCodeAt(0));
        const slot = Number(msg.slot ?? 0);
        const lamports = Number(msg.account.lamports ?? 0);

        qc.invalidateQueries({ queryKey: ['account', pubkey.toBase58()] });
        qc.invalidateQueries({ queryKey: ['anchor-account'], predicate: (q) =>
          (q.queryKey[3] as string | undefined) === pubkey.toBase58(),
        });

        onUpdateRef.current?.(pubkey, data, slot, lamports);
      } catch { /* ignore malformed messages */ }
    };

    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    return () => {
      ws.close();
      wsRef.current = null;
      setConnected(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.endpoint, config?.token, accountKeys, enabled, qc]);

  const unsubscribe = useCallback(() => {
    wsRef.current?.close();
  }, []);

  return { connected, unsubscribe };
}
