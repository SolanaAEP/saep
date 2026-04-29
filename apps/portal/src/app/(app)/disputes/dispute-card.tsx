'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { DisputeCaseRow } from '@saep/sdk-ui';
import {
  statusKey,
  verdictKey,
  truncateKey,
  fmtCountdown,
  fmtLamports,
  STATUS_LABELS,
  STATUS_COLORS,
  VERDICT_LABELS,
} from './types';

function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function activeDeadline(dispute: DisputeCaseRow, status: string): number {
  if (status === 'committing') return dispute.commitDeadline;
  if (status === 'revealing') return dispute.revealDeadline;
  return 0;
}

export function DisputeCard({ dispute }: { dispute: DisputeCaseRow }) {
  const now = useNow();
  const status = statusKey(dispute.status);
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.requestedVrf;
  const deadline = activeDeadline(dispute, status);
  const remaining = deadline > 0 ? deadline - now : 0;
  const verdict = verdictKey(dispute.verdict);
  const hasVotes = dispute.votesForAgent + dispute.votesForClient + dispute.votesForSplit > 0n;

  return (
    <Link
      href={`/disputes/${dispute.caseId.toString()}`}
      className="border border-ink/10 p-4 flex flex-col gap-3 hover:border-ink/30 transition-colors"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-ink/70">Case #{dispute.caseId.toString()}</span>
        <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 ${colors.bg} ${colors.text}`}>
          {STATUS_LABELS[status] ?? status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
        <span className="text-mute">Task</span>
        <span className="font-mono">#{dispute.taskId.toString()}</span>
        <span className="text-mute">Escrow</span>
        <span className="font-mono">{fmtLamports(dispute.escrowAmount)}</span>
        <span className="text-mute">Client</span>
        <span className="font-mono">{truncateKey(dispute.client)}</span>
        <span className="text-mute">Agent</span>
        <span className="font-mono">{truncateKey(dispute.agentOperator)}</span>
      </div>

      {remaining > 0 && (
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-mute">{status === 'committing' ? 'Commit deadline' : 'Reveal deadline'}</span>
          <span className="font-mono text-warning">{fmtCountdown(remaining)}</span>
        </div>
      )}

      {hasVotes && (
        <VerdictBar
          forAgent={dispute.votesForAgent}
          forClient={dispute.votesForClient}
          forSplit={dispute.votesForSplit}
          verdict={verdict}
        />
      )}
    </Link>
  );
}

function VerdictBar({
  forAgent,
  forClient,
  forSplit,
  verdict,
}: {
  forAgent: bigint;
  forClient: bigint;
  forSplit: bigint;
  verdict: string;
}) {
  const total = forAgent + forClient + forSplit;
  if (total === 0n) return null;
  const pctAgent = Number((forAgent * 1000n) / total) / 10;
  const pctClient = Number((forClient * 1000n) / total) / 10;
  const pctSplit = Number((forSplit * 1000n) / total) / 10;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-1.5 overflow-hidden">
        {pctAgent > 0 && <div className="bg-lime opacity-80" style={{ width: `${pctAgent}%` }} />}
        {pctClient > 0 && <div className="bg-danger opacity-80" style={{ width: `${pctClient}%` }} />}
        {pctSplit > 0 && <div className="bg-warning opacity-80" style={{ width: `${pctSplit}%` }} />}
      </div>
      {verdict !== 'none' && (
        <span className="text-[10px] text-mute font-mono">{VERDICT_LABELS[verdict] ?? verdict}</span>
      )}
    </div>
  );
}
