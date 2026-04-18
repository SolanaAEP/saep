'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useYellowstoneSubscription, type AccountUpdateHandler } from '@saep/sdk-ui';
import type { AgentSummary } from '@saep/sdk';

interface ActivityEvent {
  id: string;
  type: 'account_update';
  pubkey: string;
  slot: number;
  lamports: number;
  timestamp: number;
}

const MAX_EVENTS = 50;

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function abbrev(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function FleetActivityFeed({
  agents,
  yellowstoneEndpoint,
}: {
  agents: AgentSummary[];
  yellowstoneEndpoint: string | null;
}) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const counterRef = useRef(0);

  const accounts = agents.map((a) => a.address);

  const onUpdate: AccountUpdateHandler = useCallback((pubkey, _data, slot, lamports) => {
    const id = `${++counterRef.current}`;
    setEvents((prev) => [
      { id, type: 'account_update', pubkey: pubkey.toBase58(), slot, lamports, timestamp: Date.now() },
      ...prev.slice(0, MAX_EVENTS - 1),
    ]);
  }, []);

  const { connected } = useYellowstoneSubscription({
    config: yellowstoneEndpoint ? { endpoint: yellowstoneEndpoint } : null,
    accounts,
    enabled: accounts.length > 0 && yellowstoneEndpoint != null,
    onUpdate,
  });

  // tick every 15s to refresh relative timestamps
  const [, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="border border-ink/10 p-5 flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Activity Feed</h2>
        <div className="flex items-center gap-1.5 text-[10px] text-ink/50">
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-lime' : 'bg-danger'}`} />
          {connected ? 'Live' : yellowstoneEndpoint ? 'Disconnected' : 'No endpoint'}
        </div>
      </header>

      {events.length === 0 ? (
        <p className="text-xs text-ink/50 py-4 text-center">
          {connected
            ? 'Listening for on-chain events…'
            : 'Connect a Yellowstone endpoint to see live activity.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-1 max-h-64 overflow-y-auto">
          {events.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between text-xs py-1.5 px-2 rounded hover:bg-ink/5"
            >
              <div className="flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-lime shrink-0" />
                <span className="font-mono text-ink/70">{abbrev(e.pubkey)}</span>
                <span className="text-ink/50">slot {e.slot.toLocaleString()}</span>
              </div>
              <span className="text-ink/40">{timeAgo(e.timestamp)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
