'use client';

import { DEFAULT_YIELD_STRATEGIES } from '@saep/sdk';

const BADGES = {
  next: 'bg-lime/10 text-lime border-lime/20',
  research: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  deferred: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
} as const;

const RISK = {
  conservative: 'Conservative',
  moderate: 'Moderate',
  aggressive: 'Aggressive',
} as const;

export function YieldAutomationPanel() {
  return (
    <div className="border border-ink/10 p-5 flex flex-col gap-4">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium">Yield automation rollout</h2>
          <p className="text-[11px] text-ink/50 mt-1">
            Research-first roadmap for constrained treasury deployment. Current treasury limits and
            pause controls remain the safety boundary for every future strategy.
          </p>
        </div>
        <span className="text-[10px] text-ink/40 font-mono uppercase tracking-[0.08em]">
          not live yet
        </span>
      </header>

      <div className="grid gap-3">
        {DEFAULT_YIELD_STRATEGIES.map((strategy) => (
          <article key={strategy.id} className="border border-ink/10 p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink/60">
                  {strategy.venue}
                </div>
                <h3 className="text-sm font-medium">{strategy.label}</h3>
              </div>
              <span
                className={`inline-flex items-center border rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${BADGES[strategy.lifecycle]}`}
              >
                {strategy.lifecycle}
              </span>
            </div>
            <p className="text-xs text-ink/70 leading-relaxed">{strategy.summary}</p>
            <div className="flex flex-wrap gap-3 text-[10px] font-mono text-ink/45 uppercase tracking-[0.08em]">
              <span>risk: {RISK[strategy.riskTier]}</span>
              <span>mints: {strategy.allowedMints.join(', ')}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
