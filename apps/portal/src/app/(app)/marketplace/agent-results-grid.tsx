'use client';

import type { SerializedAgent } from '@/lib/agent-serializer';
import { sanitize } from '@/lib/sanitize';
import { maskToTags } from '../dashboard/capability-tags';
import { GlitchComposition, GlitchButton } from '@saep/ui';

const STATUS_STYLE: Record<string, string> = {
  active: 'text-lime border-lime/30',
  paused: 'text-yellow-500 border-yellow-500/30',
  suspended: 'text-danger border-danger/30',
  deregistered: 'text-mute border-mute/30',
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
      <div className="border border-dashed border-ink/20 p-8 text-center">
        <p className="font-mono text-sm text-mute">NO AGENTS MATCH FILTER</p>
      </div>
    );
  }

  const sorted = [...agents].sort((a, b) => compositeScore(b) - compositeScore(a));

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {sorted.map((agent) => {
        const tags = maskToTags(BigInt(agent.capabilityMask));
        const score = compositeScore(agent);
        const statusClass = STATUS_STYLE[agent.status] ?? '';

        return (
          <div
            key={agent.address}
            className="group border border-ink/10 flex flex-col overflow-hidden hover:border-lime/40 transition-colors"
          >
            <div className="relative h-20 overflow-hidden">
              <GlitchComposition
                seed={agent.address}
                className="absolute inset-0 opacity-60 group-hover:opacity-80 transition-opacity"
              />
              <div className="absolute top-2 right-2">
                <span className={`font-mono text-[9px] uppercase px-1.5 py-0.5 border ${statusClass}`}>
                  {agent.status}
                </span>
              </div>
            </div>

            <div className="p-4 flex flex-col gap-3 flex-1">
              <header>
                <a
                  href={`/agents/${agent.did}`}
                  className="font-mono text-xs truncate block hover:text-lime transition-colors"
                >
                  {sanitize(agent.manifestUri) || `${agent.did.slice(0, 16)}...`}
                </a>
                <div className="font-mono text-[9px] text-mute mt-0.5">
                  {agent.address.slice(0, 4)}...{agent.address.slice(-4)}
                </div>
              </header>

              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {tags.slice(0, 4).map((t) => (
                    <span key={t} className="font-mono text-[9px] px-1.5 py-0.5 border border-ink/10 text-ink/70">
                      {t}
                    </span>
                  ))}
                  {tags.length > 4 && (
                    <span className="font-mono text-[9px] px-1.5 py-0.5 text-mute">+{tags.length - 4}</span>
                  )}
                </div>
              )}

              <div className="grid grid-cols-3 gap-3 font-mono text-[11px] border-t border-ink/10 pt-3">
                <div>
                  <div className="text-[9px] text-mute uppercase">Score</div>
                  <div>{Math.round(score).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-[9px] text-mute uppercase">Price</div>
                  <div>{fmtSol(agent.priceLamports)} SOL</div>
                </div>
                <div>
                  <div className="text-[9px] text-mute uppercase">Jobs</div>
                  <div>{agent.jobsCompleted}</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 font-mono text-[11px] border-t border-ink/10 pt-3">
                <div>
                  <div className="text-[9px] text-mute uppercase">Quality</div>
                  <div>{agent.reputation.quality.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-[9px] text-mute uppercase">Time</div>
                  <div>{agent.reputation.timeliness.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-[9px] text-mute uppercase">Stake</div>
                  <div>{fmtSol(agent.stakeAmount)}</div>
                </div>
              </div>

              <GlitchButton variant="solid" size="sm" onClick={() => onHire(agent)} disabled={agent.status !== 'active'} className="mt-auto">
                HIRE AGENT
              </GlitchButton>
            </div>
          </div>
        );
      })}
    </div>
  );
}
