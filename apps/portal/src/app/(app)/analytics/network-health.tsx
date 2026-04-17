'use client';

export interface NetworkHealth {
  tps: number;
  slotTimeMs: number;
  finalityTimeMs: number;
  status: 'healthy' | 'degraded' | 'down';
  lastUpdated: string;
}

const STATUS_STYLE: Record<NetworkHealth['status'], { dot: string; label: string }> = {
  healthy: { dot: 'bg-lime', label: 'Healthy' },
  degraded: { dot: 'bg-yellow-400', label: 'Degraded' },
  down: { dot: 'bg-danger', label: 'Down' },
};

export function NetworkHealthPanel({ health }: { health: NetworkHealth }) {
  const { dot, label } = STATUS_STYLE[health.status];

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
        <Stat label="Current TPS" value={health.tps.toLocaleString()} />
        <Stat label="Slot time" value={`${health.slotTimeMs}ms`} />
        <Stat label="Finality" value={`${(health.finalityTimeMs / 1000).toFixed(1)}s`} />
      </dl>

      <p className="text-[10px] text-ink/40">
        Updated {new Date(health.lastUpdated).toLocaleTimeString()}
      </p>
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
