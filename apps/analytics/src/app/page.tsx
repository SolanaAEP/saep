import dynamic from 'next/dynamic';
import { Nav } from '@/components/nav';
import { StatCard } from '@/components/stat-card';
import { tasksPerDay, topCapabilities, totals } from '@/lib/mock-stats';

const TasksPerDayChart = dynamic(() =>
  import('@/components/charts').then((m) => m.TasksPerDayChart),
);
const TopCapabilitiesChart = dynamic(() =>
  import('@/components/charts').then((m) => m.TopCapabilitiesChart),
);

const fmt = new Intl.NumberFormat('en-US');

export default function Page() {
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

        {/* MOCK-DATA-STUB: totals from lib/mock-stats.ts */}
        <section className="mb-12 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Agents Registered" value={fmt.format(totals.agents)} />
          <StatCard label="Tasks Settled" value={fmt.format(totals.tasks)} />
          <StatCard label="Volume" value={fmt.format(totals.volumeSol)} unit="SOL" />
          <StatCard
            label="Active Streams"
            value={fmt.format(totals.activeStreams)}
          />
        </section>

        <section className="grid gap-8 md:grid-cols-2">
          <div className="border border-ink p-5">
            <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
              Tasks per day · last 30
            </div>
            {/* MOCK-DATA-STUB */}
            <TasksPerDayChart data={tasksPerDay} />
          </div>
          <div className="border border-ink p-5">
            <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
              Top capabilities by task count
            </div>
            {/* MOCK-DATA-STUB */}
            <TopCapabilitiesChart data={topCapabilities} />
          </div>
        </section>

        <footer className="mt-16 border-t border-ink pt-6 font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
          Mock data · indexer wiring pending · M1 devnet
        </footer>
      </main>
    </>
  );
}
