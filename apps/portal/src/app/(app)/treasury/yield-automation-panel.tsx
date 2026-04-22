'use client';

import type { AgentSummary } from '@saep/sdk';
import { DEFAULT_YIELD_STRATEGIES } from '@saep/sdk';
import { useTreasuryYieldResearch } from '@saep/sdk-ui';

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

function formatUsdMicro(value: bigint): string {
  return `$${(Number(value) / 1_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function YieldAutomationPanel({ agent }: { agent: AgentSummary }) {
  const research = useTreasuryYieldResearch(agent.did);

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

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="border border-ink/10 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink/45">
            idle stable balance
          </div>
          <div className="mt-2 text-lg font-medium">
            {research.isLoading ? 'Loading…' : formatUsdMicro(research.data.snapshot.idleUsdMicro)}
          </div>
        </div>
        <div className="border border-ink/10 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink/45">
            deployable now
          </div>
          <div className="mt-2 text-lg font-medium">
            {research.isLoading ? 'Loading…' : formatUsdMicro(research.data.deployableUsdMicro)}
          </div>
        </div>
        <div className="border border-ink/10 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink/45">
            policy cap
          </div>
          <div className="mt-2 text-lg font-medium">
            {(research.data.policy.maxAllocationBps / 100).toFixed(2)}%
          </div>
        </div>
      </div>

      {research.data.positions.length > 0 ? (
        <div className="border border-ink/10 divide-y divide-ink/10">
          {research.data.positions.map((position) => (
            <div key={position.mint.toBase58()} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.08em]">
                  {position.symbol}
                </div>
                <div className="text-[10px] text-ink/45">{position.mint.toBase58()}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[11px]">{position.rawAmount.toString()}</div>
                <div className="text-[10px] text-ink/45">
                  {position.stableUsd ? formatUsdMicro(position.usdMicro) : 'non-stable research-only'}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {research.data.blockedReasons.length > 0 ? (
        <div className="border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] text-ink/70">
          Blocked today: {research.data.blockedReasons.join(' · ')}
        </div>
      ) : null}

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
