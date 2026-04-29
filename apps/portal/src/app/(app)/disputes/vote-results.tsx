'use client';

import type { DisputeCaseRow } from '@saep/sdk-ui';
import { verdictKey, VERDICT_LABELS } from './types';

export function VoteResults({ dispute }: { dispute: DisputeCaseRow }) {
  const total = dispute.votesForAgent + dispute.votesForClient + dispute.votesForSplit;
  if (total === 0n) {
    return (
      <div className="border border-ink/10 p-5 font-mono text-[11px] text-mute">
        No votes cast yet.
      </div>
    );
  }

  const pctAgent = Number((dispute.votesForAgent * 1000n) / total) / 10;
  const pctClient = Number((dispute.votesForClient * 1000n) / total) / 10;
  const pctSplit = Number((dispute.votesForSplit * 1000n) / total) / 10;
  const verdict = verdictKey(dispute.verdict);

  return (
    <div className="border border-ink/10 p-5 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h2 className="font-display text-lg">Vote results</h2>
        {verdict !== 'none' && (
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] px-1.5 py-0.5 bg-lime/10 text-lime">
            {VERDICT_LABELS[verdict]}
          </span>
        )}
      </header>

      <div className="flex gap-1 h-6 overflow-hidden bg-ink/5">
        {pctAgent > 0 && <div className="bg-lime opacity-80 transition-all" style={{ width: `${pctAgent}%` }} />}
        {pctClient > 0 && <div className="bg-danger opacity-80 transition-all" style={{ width: `${pctClient}%` }} />}
        {pctSplit > 0 && <div className="bg-warning opacity-80 transition-all" style={{ width: `${pctSplit}%` }} />}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2 w-2 rounded-full bg-lime opacity-80" />
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-mute">Agent wins</span>
          </div>
          <span className="font-mono text-[15px] font-medium">{pctAgent.toFixed(1)}%</span>
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2 w-2 rounded-full bg-danger opacity-80" />
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-mute">Client wins</span>
          </div>
          <span className="font-mono text-[15px] font-medium">{pctClient.toFixed(1)}%</span>
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2 w-2 rounded-full bg-warning opacity-80" />
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-mute">Split</span>
          </div>
          <span className="font-mono text-[15px] font-medium">{pctSplit.toFixed(1)}%</span>
        </div>
      </div>

      <div className="font-mono text-[10px] text-mute border-t border-ink/10 pt-3">
        Total weight: {total.toLocaleString()} · {dispute.arbitratorCount} arbitrator{dispute.arbitratorCount !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
