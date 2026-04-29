'use client';

import { useState, useEffect } from 'react';
import type { DisputeCaseRow } from '@saep/sdk-ui';
import { statusKey, fmtTs, fmtCountdown, STATUS_COLORS, type DisputeStatus } from './types';

interface Step {
  key: DisputeStatus;
  label: string;
  deadline?: (c: DisputeCaseRow) => number;
  ts?: (c: DisputeCaseRow) => number;
}

const STEPS: Step[] = [
  { key: 'requestedVrf', label: 'Raised', ts: (c) => c.createdAt },
  { key: 'selectionReady', label: 'VRF Complete' },
  { key: 'committing', label: 'Committing', deadline: (c) => c.commitDeadline },
  { key: 'revealing', label: 'Revealing', deadline: (c) => c.revealDeadline },
  { key: 'tallied', label: 'Tallied' },
  { key: 'resolved', label: 'Resolved', ts: (c) => c.resolvedAt },
];

const ORDER: Record<string, number> = {};
STEPS.forEach((s, i) => {
  ORDER[s.key] = i;
});
ORDER['appealed'] = ORDER['tallied']!;
ORDER['cancelled'] = 6;

function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function DisputeTimeline({ dispute }: { dispute: DisputeCaseRow }) {
  const now = useNow();
  const current = statusKey(dispute.status);
  const currentOrder = ORDER[current] ?? 0;
  const terminal = current === 'resolved' || current === 'cancelled';

  return (
    <div className="border border-ink/10 p-5 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h2 className="font-display text-lg">Timeline</h2>
        <StatusBadge status={current} />
      </header>

      <ol className="flex flex-col gap-3">
        {STEPS.map((step, idx) => {
          const reached = idx <= currentOrder;
          const active = step.key === current && !terminal;
          const color = reached
            ? (STATUS_COLORS[step.key] ?? STATUS_COLORS.requestedVrf)
            : { dot: 'bg-ink/20', text: 'text-ink/40', bg: '' };
          const ts = step.ts?.(dispute) ?? 0;
          const deadline = step.deadline?.(dispute) ?? 0;
          const remaining = active && deadline > 0 ? deadline - now : 0;

          return (
            <li key={step.key} className="flex items-center gap-3 font-mono text-[12px]">
              <span
                className={`h-2.5 w-2.5 rounded-full shrink-0 ${color.dot} ${active ? 'ring-2 ring-offset-2 ring-lime/50 animate-pulse' : ''}`}
              />
              <span className={`flex-1 ${reached ? '' : 'text-ink/40'}`}>{step.label}</span>
              {active && remaining > 0 ? (
                <span className="font-mono text-warning">{fmtCountdown(remaining)}</span>
              ) : (
                <span className="font-mono text-ink/50">{reached && ts ? fmtTs(ts) : '—'}</span>
              )}
            </li>
          );
        })}

        {current === 'appealed' && (
          <li className="flex items-center gap-3 text-xs">
            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${STATUS_COLORS.appealed.dot} ring-2 ring-offset-2 ring-danger/50 animate-pulse`} />
            <span>Appealed (round {dispute.round})</span>
            <span className="font-mono text-ink/50">—</span>
          </li>
        )}

        {current === 'cancelled' && (
          <li className="flex items-center gap-3 text-xs">
            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${STATUS_COLORS.cancelled.dot}`} />
            <span className="text-ink/40">Cancelled</span>
            <span className="font-mono text-ink/50">—</span>
          </li>
        )}
      </ol>
    </div>
  );
}

function StatusBadge({ status }: { status: DisputeStatus }) {
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.requestedVrf;
  const label = status.replace(/([A-Z])/g, ' $1').trim();
  return (
    <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 ${color.bg} ${color.text}`}>
      {label}
    </span>
  );
}
