'use client';

import type { AgentSummary } from '@saep/sdk';
import { useTreasury } from '@saep/sdk-ui';
import { useQueries } from '@tanstack/react-query';
import { useTreasuryProgram } from '@saep/sdk-ui';
import { fetchTreasury } from '@saep/sdk';

interface AggregatedBalance {
  totalDailyLimit: bigint;
  totalSpentToday: bigint;
  totalWeeklyLimit: bigint;
  totalSpentThisWeek: bigint;
  activeStreams: number;
  treasuryCount: number;
}

function fmtSol(v: bigint): string {
  return `${(Number(v) / 1e9).toFixed(4)}`;
}

function useTreasuryAggregate(agents: AgentSummary[]) {
  const program = useTreasuryProgram();

  const queries = useQueries({
    queries: agents.map((agent) => ({
      queryKey: ['treasury', Buffer.from(agent.did).toString('hex')],
      enabled: Boolean(program),
      queryFn: () => fetchTreasury(program!, agent.did),
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);
  const treasuries = queries
    .map((q) => q.data)
    .filter((t): t is NonNullable<typeof t> => t != null);

  const aggregate: AggregatedBalance = {
    totalDailyLimit: treasuries.reduce((sum, t) => sum + t.dailySpendLimit, 0n),
    totalSpentToday: treasuries.reduce((sum, t) => sum + t.spentToday, 0n),
    totalWeeklyLimit: treasuries.reduce((sum, t) => sum + t.weeklyLimit, 0n),
    totalSpentThisWeek: treasuries.reduce((sum, t) => sum + t.spentThisWeek, 0n),
    activeStreams: treasuries.filter((t) => t.streamingActive).length,
    treasuryCount: treasuries.length,
  };

  return { aggregate, isLoading, treasuryCount: treasuries.length };
}

export function TreasuryOverviewPanel({ agents }: { agents: AgentSummary[] }) {
  const { aggregate, isLoading, treasuryCount } = useTreasuryAggregate(agents);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-ink/10 p-5">
        <p className="text-xs text-ink/50">Loading treasury overview…</p>
      </div>
    );
  }

  if (treasuryCount === 0) {
    return (
      <div className="rounded-lg border border-dashed border-ink/20 p-5 text-sm text-ink/60">
        No treasuries initialized yet.
      </div>
    );
  }

  const dailyPct = aggregate.totalDailyLimit > 0n
    ? Number((aggregate.totalSpentToday * 10000n) / aggregate.totalDailyLimit) / 100
    : 0;

  return (
    <div className="rounded-lg border border-ink/10 p-5 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Treasury Overview</h2>
        <span className="text-[10px] text-ink/50">{treasuryCount} treasuries</span>
      </header>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
        <Stat label="Spent today" value={`${fmtSol(aggregate.totalSpentToday)} SOL`} />
        <Stat label="Daily limit" value={`${fmtSol(aggregate.totalDailyLimit)} SOL`} />
        <Stat label="Weekly spend" value={`${fmtSol(aggregate.totalSpentThisWeek)} SOL`} />
        <Stat label="Active streams" value={aggregate.activeStreams.toString()} />
      </dl>

      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[10px] text-ink/50">
          <span>Daily utilization</span>
          <span>{dailyPct.toFixed(1)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-ink/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-lime transition-all"
            style={{ width: `${Math.min(dailyPct, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink/50">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}
