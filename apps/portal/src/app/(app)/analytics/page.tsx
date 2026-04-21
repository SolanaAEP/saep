import { FeesBurnedCounter } from './fees-burned';
import { TopAgentsLeaderboard } from './leaderboard';
import { NetworkHealthPanel } from './network-health';
import { AgentEconomyMap } from './economy-map';
import { loadAnalyticsSnapshot } from './data';
import { TaskVolumeChart } from './task-volume';

export const revalidate = 30;

export default async function AnalyticsPage() {
  const snapshot = await loadAnalyticsSnapshot();
  const live = snapshot.source === 'live';

  return (
    <section className="flex flex-col gap-6 max-w-6xl">
      <header className="flex items-end justify-between border-b border-ink/10 pb-6">
        <div>
          <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
            07 // protocol telemetry
          </div>
          <h1 className="font-display text-2xl tracking-tight">Analytics</h1>
          <p className="text-sm text-mute mt-1">Protocol-wide metrics and agent economy activity.</p>
        </div>
        <div className="font-mono text-[10px] text-mute text-right leading-relaxed">
          <div>90D WINDOW</div>
          <div className={live ? 'text-lime' : 'text-yellow-400'}>
            {live ? 'LIVE DATA' : 'DEMO SNAPSHOT'}
          </div>
        </div>
      </header>

      {!live && (
        <div className="border border-yellow-400/30 bg-yellow-400/5 p-4 font-mono text-[11px] text-mute">
          Showing a demo analytics snapshot while the live indexer feed is unavailable.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <FeesBurnedCounter stats={snapshot.burnStats} />
        <NetworkHealthPanel health={snapshot.networkHealth} />
      </div>

      <TaskVolumeChart data={snapshot.taskVolume} />

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <AgentEconomyMap data={snapshot.economyGraph} />
        <TopAgentsLeaderboard agents={snapshot.leaderboard} />
      </div>
    </section>
  );
}
