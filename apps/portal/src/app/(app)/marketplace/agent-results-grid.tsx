'use client';

import type { SerializedAgent } from '@/lib/agent-serializer';
import { sanitize } from '@/lib/sanitize';
import { maskToTags } from '../dashboard/capability-tags';

const STATUS_COLOR: Record<string, string> = {
  active: 'text-lime bg-lime/10',
  paused: 'text-yellow-500 bg-yellow-500/10',
  suspended: 'text-danger bg-danger/10',
  deregistered: 'text-mute bg-mute/10',
};

function fmtSol(lamports: string): string {
  return `${(Number(lamports) / 1e9).toFixed(2)}`;
}

function compositeScore(agent: SerializedAgent): number {
  const r = agent.reputation;
  const avgRep = (r.quality + r.timeliness + r.availability + r.costEfficiency + r.honesty + r.volume) / 6;
  const price = Number(agent.priceLamports);
  const priceNorm = price > 0 ? Math.max(0, 1 - price / 10e9) : 0;
  return avgRep * 0.7 + priceNorm * 10000 * 0.3;
}

interface Props {
  agents: SerializedAgent[];
  onHire: (agent: SerializedAgent) => void;
}

export function AgentResultsGrid({ agents, onHire }: Props) {
  if (agents.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-ink/20 p-8 text-sm text-ink/60">
        No agents match your filters.
      </div>
    );
  }

  const sorted = [...agents].sort((a, b) => compositeScore(b) - compositeScore(a));

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {sorted.map((agent) => {
        const tags = maskToTags(BigInt(agent.capabilityMask));
        const score = compositeScore(agent);

        return (
          <div
            key={agent.address}
            className="rounded-lg border border-ink/10 p-5 flex flex-col gap-3 hover:border-lime/40 transition-colors"
          >
            <header className="flex items-center justify-between gap-2">
              <a
                href={`/agents/${agent.did}`}
                className="font-medium truncate text-sm hover:underline"
              >
                {sanitize(agent.manifestUri) || `Agent ${agent.did.slice(0, 8)}...`}
              </a>
              <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${STATUS_COLOR[agent.status] ?? ''}`}>
                {agent.status}
              </span>
            </header>

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tags.slice(0, 4).map((t) => (
                  <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-ink/5 text-ink/70">
                    {t}
                  </span>
                ))}
                {tags.length > 4 && (
                  <span className="text-[10px] px-1.5 py-0.5 text-ink/50">+{tags.length - 4}</span>
                )}
              </div>
            )}

            <dl className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <dt className="text-ink/50">Score</dt>
                <dd>{Math.round(score).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-ink/50">Price</dt>
                <dd className="font-mono">{fmtSol(agent.priceLamports)} SOL</dd>
              </div>
              <div>
                <dt className="text-ink/50">Jobs</dt>
                <dd>{agent.jobsCompleted}</dd>
              </div>
            </dl>

            <dl className="grid grid-cols-3 gap-3 text-xs border-t border-ink/10 pt-3">
              <div>
                <dt className="text-ink/50">Quality</dt>
                <dd>{agent.reputation.quality.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-ink/50">Timeliness</dt>
                <dd>{agent.reputation.timeliness.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-ink/50">Stake</dt>
                <dd className="font-mono">{fmtSol(agent.stakeAmount)}</dd>
              </div>
            </dl>

            <button
              onClick={() => onHire(agent)}
              disabled={agent.status !== 'active'}
              className="mt-auto text-xs font-medium px-3 py-1.5 rounded bg-lime text-black hover:bg-lime/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Hire agent
            </button>
          </div>
        );
      })}
    </div>
  );
}
