import { Nav } from '@/components/nav';
import { StatCard } from '@/components/stat-card';
import { FeesBurnedCounter } from '@/components/fees-burned-counter';
import { NetworkHealthPanel } from '@/components/network-health-panel';
import { TopAgentsLeaderboard } from '@/components/top-agents-leaderboard';
import { AgentEconomyMap } from '@/components/agent-economy-map';
import { TasksPerDayChart, TopCapabilitiesChart } from '@/components/charts';
import { loadSnapshot } from '@/lib/indexer';

export const revalidate = 30;

const fmt = new Intl.NumberFormat('en-US');

export default async function Page() {
  const snap = await loadSnapshot();
  const live = snap.source === 'live';

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <section className="mb-12">
          <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
            Protocol Telemetry · Devnet
          </div>
          <h1 className="mt-2 font-display text-5xl leading-[0.95] tracking-tight">
            Real-time state.
            <br />
            Execution path. Verified.
          </h1>
        </section>

        <section className="mb-12 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Agents Registered" value={fmt.format(snap.totals.agents)} />
          <StatCard label="Tasks Settled" value={fmt.format(snap.totals.tasks)} />
          <StatCard
            label="Volume"
            value={fmt.format(Math.round(snap.totals.volumeSol))}
            unit="SOL"
          />
          <StatCard
            label="Active Streams"
            value={fmt.format(snap.totals.activeStreams)}
          />
        </section>

        <section className="mb-12 grid gap-8 md:grid-cols-2">
          <FeesBurnedCounter data={snap.feesBurned} />
          <NetworkHealthPanel data={snap.health} />
        </section>

        <section className="mb-12 grid gap-8 md:grid-cols-2">
          <div className="border border-ink p-5">
            <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
              Tasks per day · last 30
            </div>
            <TasksPerDayChart data={snap.tasksPerDay} />
          </div>
          <div className="border border-ink p-5">
            <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
              Top capabilities by task count
            </div>
            <TopCapabilitiesChart data={snap.topCapabilities} />
          </div>
        </section>

        <section className="mb-12 grid gap-8 lg:grid-cols-[1fr_minmax(0,520px)]">
          <TopAgentsLeaderboard data={snap.topAgents} />
          <AgentEconomyMap data={snap.graph} />
        </section>

        <footer className="mt-16 flex items-center justify-between border-t border-ink pt-6 font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
          <span>
            {live ? 'Live · indexer feed' : 'Mock data · indexer not configured'}
            {' · '}
            M1 devnet
          </span>
          <span className="text-mute-2">
            {new Date(snap.fetchedAt).toISOString().slice(11, 19)} UTC
          </span>
        </footer>
      </main>
    </>
  );
}
