import type { NetworkHealth as Health } from '@/lib/analytics';

type Status = 'healthy' | 'degraded' | 'idle';

const STATUS_STYLE: Record<Status, { dot: string; label: string }> = {
  healthy: { dot: 'bg-lime', label: 'Healthy' },
  degraded: { dot: 'bg-yellow-400', label: 'Degraded' },
  idle: { dot: 'bg-ink/40', label: 'Idle' },
};

function deriveStatus(health: Health): Status {
  if (health.reorgs24h > 5) return 'degraded';
  if (health.eventsPerMin === 0) return 'idle';
  return 'healthy';
}

export function NetworkHealthPanel({ health }: { health: Health }) {
  const { dot, label } = STATUS_STYLE[deriveStatus(health)];

  return (
    <div className="rounded-lg border border-ink/10 p-5 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Network Health</h2>
        <span className="flex items-center gap-1.5 text-[10px] text-ink/60">
          <span className={`w-1.5 h-1.5 rounded-full ${dot} animate-pulse`} />
          {label}
        </span>
      </header>

      <dl className="grid gap-4 text-xs">
        <Stat label="Latest slot" value={health.latestSlot.toLocaleString()} />
        <Stat label="Reorgs · 24h" value={health.reorgs24h.toLocaleString()} />
        <Stat label="Events / min" value={health.eventsPerMin.toLocaleString()} />
        <Stat label="Events · total" value={health.eventsTotal.toLocaleString()} />
        <Stat label="Blocks · total" value={health.blocksTotal.toLocaleString()} />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <dt className="text-ink/50">{label}</dt>
      <dd className="font-mono font-medium">{value}</dd>
    </div>
  );
}
