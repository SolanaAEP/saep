'use client';

import { useState } from 'react';
import Link from 'next/link';

export interface LeaderboardAgent {
  did: string;
  name: string;
  jobsCompleted: number;
  totalEarnedUsdc: number;
  reputationScore: number;
}

type SortKey = 'jobsCompleted' | 'totalEarnedUsdc' | 'reputationScore';

const SORT_LABELS: Record<SortKey, string> = {
  jobsCompleted: 'Jobs',
  totalEarnedUsdc: 'Earned',
  reputationScore: 'Reputation',
};

function didToSlug(did: string): string {
  return did.replace('did:saep:', '');
}

function fmtUsdc(v: number): string {
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`;
}

function fmtReputation(v: number): string {
  return (v / 100).toFixed(1);
}

export function TopAgentsLeaderboard({ agents }: { agents: LeaderboardAgent[] }) {
  const [sortBy, setSortBy] = useState<SortKey>('jobsCompleted');

  const sorted = [...agents]
    .sort((a, b) => b[sortBy] - a[sortBy])
    .slice(0, 20);

  return (
    <div className="border border-ink/10 p-5 flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Top Agents</h2>
        <span className="text-[10px] text-ink/50">Top 20</span>
      </header>

      <div className="flex gap-1">
        {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
          <button
            key={key}
            onClick={() => setSortBy(key)}
            className={`text-[10px] px-2 py-1 rounded transition-colors ${
              sortBy === key ? 'bg-lime/15 text-lime font-medium' : 'text-ink/50 hover:text-ink/80'
            }`}
          >
            {SORT_LABELS[key]}
          </button>
        ))}
      </div>

      <div className="flex flex-col divide-y divide-ink/5 max-h-[480px] overflow-y-auto">
        {sorted.map((agent, i) => (
          <div key={agent.did} className="flex items-center gap-3 py-2 text-xs">
            <span className="text-ink/40 font-mono w-5 text-right shrink-0">{i + 1}</span>
            <Link
              href={`/agents/${didToSlug(agent.did)}`}
              className="truncate font-medium hover:text-lime transition-colors flex-1 min-w-0"
            >
              {agent.name}
            </Link>
            <dl className="flex gap-4 shrink-0 text-ink/60">
              <span className="font-mono" title="Jobs completed">{agent.jobsCompleted}</span>
              <span className="font-mono" title="Total earned">{fmtUsdc(agent.totalEarnedUsdc)}</span>
              <span className="font-mono" title="Reputation score">{fmtReputation(agent.reputationScore)}</span>
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
