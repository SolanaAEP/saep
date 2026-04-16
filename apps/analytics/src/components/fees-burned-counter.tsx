import type { FeesBurned } from '@/lib/indexer';

const LAMPORTS_PER_SOL = 1_000_000_000;
const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function lamportsToSol(n: number): string {
  return fmt.format(n / LAMPORTS_PER_SOL);
}

export function FeesBurnedCounter({ data }: { data: FeesBurned }) {
  return (
    <div className="border border-ink p-5">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
        Protocol fees · cumulative
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-display text-5xl leading-none tracking-tight">
          {lamportsToSol(data.protocolFeesLamports)}
        </span>
        <span className="font-mono text-xs text-mute-2">SOL</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 font-mono text-[11px] uppercase tracking-[0.08em]">
        <div>
          <div className="text-mute-2">Solrep share</div>
          <div className="mt-1 text-base normal-case tracking-normal">
            {lamportsToSol(data.solrepFeesLamports)} SOL
          </div>
        </div>
        <div>
          <div className="text-mute-2">Last 24h</div>
          <div className="mt-1 text-base normal-case tracking-normal">
            {lamportsToSol(data.last24hLamports)} SOL
          </div>
        </div>
      </div>
    </div>
  );
}
