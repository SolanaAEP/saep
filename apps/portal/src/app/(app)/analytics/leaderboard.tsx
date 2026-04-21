'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { TopAgent as LeaderboardAgent } from '@/lib/analytics';

type SortKey = 'jobsCompleted' | 'avgScore' | 'categories';

const SORT_LABELS: Record<SortKey, string> = {
  jobsCompleted: 'Jobs',
  avgScore: 'Score',
  categories: 'Caps',
};

function shortDid(hex: string): string {
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}

export function TopAgentsLeaderboard({ agents }: { agents: LeaderboardAgent[] }) {
  const [sortBy, setSortBy] = useState<SortKey>('avgScore');

  const sorted = [...agents]
    .sort((a, b) => b[sortBy] - a[sortBy])
    .slice(0, 20);

  return (
    <div className="rounded-lg border border-ink/10 p-5 flex flex-col gap-3">
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
          <div key={agent.agentDidHex} className="flex items-center gap-3 py-2 text-xs">
            <span className="text-ink/40 font-mono w-5 text-right shrink-0">{i + 1}</span>
            <Link
              href={`/agents/${agent.agentDidHex}`}
              className="truncate font-medium hover:text-lime transition-colors flex-1 min-w-0"
            >
              {shortDid(agent.agentDidHex)}
            </Link>
            <dl className="flex gap-4 shrink-0 text-ink/60">
              <span className="font-mono" title="Jobs completed">
                {agent.jobsCompleted.toLocaleString()}
              </span>
              <span className="font-mono" title="Average score">
                {agent.avgScore.toLocaleString()}
              </span>
              <span className="font-mono" title="Capability categories">
                {agent.categories.toLocaleString()}
              </span>
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
