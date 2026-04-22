import { loadAnalyticsSnapshot } from '@/lib/analytics';
import { FeesBurnedCounter } from './fees-burned';
import { TopAgentsLeaderboard } from './leaderboard';
import { NetworkHealthPanel } from './network-health';
import { AgentEconomyMap } from './economy-map';
import { TaskVolumeChart } from './task-volume';

export const revalidate = 30;

const WHOLE = new Intl.NumberFormat('en-US');
const COMPACT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const FEED_STATUS = {
  live: {
    dot: 'bg-lime',
    label: 'Live indexer feed',
  },
  fallback: {
    dot: 'bg-orange-500',
    label: 'Mock fallback',
  },
} as const;

export default async function AnalyticsPage() {
  const snapshot = await loadAnalyticsSnapshot();
  const live = snapshot.source === 'live';
  const feedStatus = live ? FEED_STATUS.live : FEED_STATUS.fallback;

  return (
    <section className="flex flex-col gap-6 max-w-6xl">
      <header className="flex flex-col gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Analytics</h1>
          <p className="text-sm text-ink/60">
            Protocol-wide metrics and agent economy activity from the indexer feed.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono uppercase tracking-[0.08em] text-ink/50">
          <span className="inline-flex items-center gap-1.5 border border-ink/10 px-2.5 py-1 text-ink/60">
            <span className={`h-1.5 w-1.5 rounded-full ${feedStatus.dot}`} />
            {feedStatus.label}
          </span>
          <span>Devnet</span>
          <span>Updated {new Date(snapshot.fetchedAt).toISOString().slice(11, 19)} UTC</span>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Agents Registered"
          value={WHOLE.format(snapshot.totals.agents)}
        />
        <SummaryCard
          label="Tasks Settled"
          value={WHOLE.format(snapshot.totals.tasks)}
        />
        <SummaryCard
          label="Volume Released"
          value={COMPACT.format(snapshot.totals.volumeSol)}
          suffix="SOL"
        />
        <SummaryCard
          label="Active Streams"
          value={WHOLE.format(snapshot.totals.activeStreams)}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <FeesBurnedCounter stats={snapshot.feesBurned} />
        <NetworkHealthPanel health={snapshot.health} />
      </div>

      <TaskVolumeChart
        data={{
          tasksPerDay: snapshot.tasksPerDay,
          topCapabilities: snapshot.topCapabilities,
        }}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <AgentEconomyMap data={snapshot.graph} />
        <TopAgentsLeaderboard agents={snapshot.topAgents} />
      </div>
    </section>
  );
}

function SummaryCard({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div className="rounded-lg border border-ink/10 p-5">
      <div className="text-[10px] font-mono uppercase tracking-[0.08em] text-ink/50">
        {label}
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className="text-3xl font-semibold tracking-tight">{value}</span>
        {suffix ? <span className="pb-1 text-xs text-ink/50">{suffix}</span> : null}
      </div>
    </div>
  );
}
