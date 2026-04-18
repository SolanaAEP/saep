'use client';

import type { AgentSummary, StreamSummary } from '@saep/sdk';
import { useAgentStreams } from '@saep/sdk-ui';

function fmtSol(lamports: bigint): string {
  return (Number(lamports) / 1e9).toFixed(4);
}

function streamedSoFar(s: StreamSummary, nowSec: number): bigint {
  if (s.status !== 'active') return s.withdrawn;
  const elapsed = BigInt(Math.max(0, nowSec - s.startTime));
  const cap = s.maxDuration > 0 ? BigInt(s.maxDuration) : elapsed;
  const duration = elapsed < cap ? elapsed : cap;
  const streamed = s.ratePerSec * duration;
  return streamed > s.depositTotal ? s.depositTotal : streamed;
}

function statusBadge(status: StreamSummary['status']) {
  const map = {
    active: 'text-lime bg-lime/10',
    paused: 'text-ink/60 bg-ink/5',
    closed: 'text-ink/40 bg-ink/5',
    expired: 'text-danger/80 bg-danger/10',
  };
  return map[status];
}

export function StreamingPaymentsMonitor({ agent }: { agent: AgentSummary }) {
  const { data: streams, isLoading } = useAgentStreams(agent.did);
  const now = Math.floor(Date.now() / 1000);

  const active = streams?.filter((s) => s.status === 'active') ?? [];
  const totalRate = active.reduce((sum, s) => sum + s.ratePerSec, 0n);

  return (
    <div className="border border-ink/10 p-5 flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Streaming payments</h2>
        <div className="flex gap-3 text-[10px] text-ink/50">
          <span>{active.length} active</span>
          <span className="font-mono">{fmtSol(totalRate)} SOL/sec aggregate</span>
        </div>
      </header>

      {isLoading && <p className="text-xs text-ink/50">Loading streams…</p>}

      {streams && streams.length === 0 && (
        <p className="text-xs text-ink/50">No streams opened to this agent.</p>
      )}

      {streams && streams.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {streams.map((s) => {
            const streamed = streamedSoFar(s, now);
            const utilization = s.depositTotal > 0n
              ? Number((streamed * 10000n) / s.depositTotal) / 100
              : 0;
            const remaining = s.depositTotal - streamed;
            return (
              <li
                key={s.address.toBase58()}
                className="border border-ink/10 p-3 flex flex-col gap-2"
              >
                <div className="flex justify-between items-baseline">
                  <div className="flex gap-2 items-baseline">
                    <span className={`text-[10px] px-1.5 py-0.5 ${statusBadge(s.status)}`}>
                      {s.status}
                    </span>
                    <span className="font-mono text-xs text-ink/60">
                      from {s.client.toBase58().slice(0, 8)}…
                    </span>
                  </div>
                  <span className="text-[10px] text-ink/50 font-mono">
                    {fmtSol(s.ratePerSec)} SOL/s
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-[10px] text-ink/50">
                    <span>
                      {fmtSol(streamed)} / {fmtSol(s.depositTotal)} SOL streamed
                    </span>
                    <span>{utilization.toFixed(1)}%</span>
                  </div>
                  <div className="h-1 rounded-full bg-ink/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-lime transition-all"
                      style={{ width: `${Math.min(utilization, 100)}%` }}
                    />
                  </div>
                </div>

                <div className="flex justify-between text-[10px] text-ink/40 font-mono">
                  <span>remaining {fmtSol(remaining)} SOL</span>
                  <span>withdrawn {fmtSol(s.withdrawn)} SOL</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
