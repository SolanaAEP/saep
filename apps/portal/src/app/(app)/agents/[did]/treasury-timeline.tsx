'use client';

import type { TreasurySummary } from '@saep/sdk';

function fmtSol(v: bigint): string {
  return `${(Number(v) / 1e9).toFixed(2)}`;
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-ink/50">{label}</dt>
      <dd className={mono ? 'font-mono' : ''}>{value}</dd>
    </div>
  );
}

export function TreasuryTimeline({ treasury }: { treasury: TreasurySummary | null }) {
  if (!treasury) {
    return (
      <div className="rounded-lg border border-dashed border-ink/20 p-5 text-xs text-ink/50">
        No treasury configured for this agent.
      </div>
    );
  }

  const dailyPct =
    treasury.dailySpendLimit > 0n
      ? Number((treasury.spentToday * 10000n) / treasury.dailySpendLimit) / 100
      : 0;
  const weeklyPct =
    treasury.weeklyLimit > 0n
      ? Number((treasury.spentThisWeek * 10000n) / treasury.weeklyLimit) / 100
      : 0;

  return (
    <div className="rounded-lg border border-ink/10 p-5 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Treasury</h2>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded ${
            treasury.streamingActive ? 'text-lime bg-lime/10' : 'text-ink/50 bg-ink/5'
          }`}
        >
          {treasury.streamingActive ? 'streaming' : 'idle'}
        </span>
      </header>

      <dl className="grid grid-cols-3 gap-3 text-xs">
        <Stat label="Per-tx limit" value={`${fmtSol(treasury.perTxLimit)} SOL`} mono />
        <Stat label="Daily limit" value={`${fmtSol(treasury.dailySpendLimit)} SOL`} mono />
        <Stat label="Weekly limit" value={`${fmtSol(treasury.weeklyLimit)} SOL`} mono />
      </dl>

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-[10px] text-ink/50">
            <span>Daily ({fmtSol(treasury.spentToday)} / {fmtSol(treasury.dailySpendLimit)})</span>
            <span>{dailyPct.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-ink/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-lime transition-all"
              style={{ width: `${Math.min(dailyPct, 100)}%` }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-[10px] text-ink/50">
            <span>
              Weekly ({fmtSol(treasury.spentThisWeek)} / {fmtSol(treasury.weeklyLimit)})
            </span>
            <span>{weeklyPct.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-ink/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-lime transition-all"
              style={{ width: `${Math.min(weeklyPct, 100)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
