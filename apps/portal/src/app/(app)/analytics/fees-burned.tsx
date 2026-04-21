import type { FeesBurned as BurnStats } from '@/lib/analytics';

const LAMPORTS_PER_SOL = 1_000_000_000;
const FORMATTER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function lamportsToSol(value: number): string {
  return FORMATTER.format(value / LAMPORTS_PER_SOL);
}

export function FeesBurnedCounter({ stats }: { stats: BurnStats }) {
  return (
    <div className="rounded-lg border border-ink/10 p-5 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Fees Burned</h2>
        <span className="text-[10px] text-ink/50 font-mono">Task settlement</span>
      </header>

      <div className="text-3xl font-mono font-semibold tracking-tight">
        {lamportsToSol(stats.protocolFeesLamports)}
        <span className="text-sm text-ink/50 ml-1.5">SOL</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="Solrep share" value={`${lamportsToSol(stats.solrepFeesLamports)} SOL`} />
        <Stat label="Last 24h" value={`${lamportsToSol(stats.last24hLamports)} SOL`} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-ink/5 px-3 py-2">
      <div className="text-[10px] text-ink/50 uppercase tracking-[0.08em]">{label}</div>
      <div className="mt-1 font-mono text-sm">{value}</div>
    </div>
  );
}
