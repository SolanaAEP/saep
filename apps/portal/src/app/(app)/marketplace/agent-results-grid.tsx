'use client';

import { useMemo } from 'react';
import { useDiscoveryAgents, type DiscoveryAgentMatchSummary } from '@saep/sdk-ui';
import type { SerializedAgent } from '@/lib/agent-serializer';
import { getPortalIndexerUrl } from '@/lib/indexer-url';
import { sanitize } from '@/lib/sanitize';
import { maskToTags } from '../dashboard/capability-tags';

const STATUS_STYLE: Record<string, string> = {
  active: 'text-lime border-lime/30',
  paused: 'text-amber-600 border-amber-500/30',
  suspended: 'text-danger border-danger/30',
  deregistered: 'text-mute border-ink/15',
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

function humanizeSlug(value: string): string {
  return value
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

function agentTitle(agent: SerializedAgent): string {
  const manifest = sanitize(agent.manifestUri)?.trim();
  if (!manifest) return `${agent.did.slice(0, 16)}…`;
  try {
    const url = new URL(manifest);
    const last = url.pathname.split('/').filter(Boolean).pop();
    if (last) return humanizeSlug(last);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return humanizeSlug(manifest);
  }
}

function agentSubtitle(agent: SerializedAgent): string {
  const manifest = sanitize(agent.manifestUri)?.trim();
  if (!manifest) return `${agent.address.slice(0, 6)}…${agent.address.slice(-4)}`;
  try {
    const url = new URL(manifest);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return manifest;
  }
}

interface Props {
  agents: SerializedAgent[];
  selectedBits: number[];
  onHire: (agent: SerializedAgent) => void;
}

const INDEXER_URL = getPortalIndexerUrl();

function toPct(value: number | null | undefined, max = 10_000): string {
  if (value == null) return 'n/a';
  return `${Math.round((Math.max(0, Math.min(value, max)) / max) * 100)}%`;
}

function selectedMaskHex(selectedBits: number[]): string | null {
  if (selectedBits.length === 0) return null;
  const mask = selectedBits.reduce((acc, bit) => acc | (1n << BigInt(bit)), 0n);
  return mask.toString(16);
}

function explainMatch(matchSummary: DiscoveryAgentMatchSummary): string {
  const segments = [
    `${Math.round(matchSummary.coverageBps / 100)}% capability coverage`,
    `fit ${toPct(matchSummary.fitScore)}`,
  ];
  if (matchSummary.capabilityReputationComposite != null) {
    segments.push(`cap rep ${toPct(matchSummary.capabilityReputationComposite)}`);
  }
  if (matchSummary.availability != null) {
    segments.push(`availability ${toPct(matchSummary.availability)}`);
  }
  return segments.join(' • ');
}

export function AgentResultsGrid({ agents, selectedBits, onHire }: Props) {
  const capabilityMaskHex = useMemo(() => selectedMaskHex(selectedBits), [selectedBits]);
  const { data: rankedAgents, isLoading: isLoadingMatches } = useDiscoveryAgents({
    indexerUrl: INDEXER_URL,
    capabilityMaskHex,
    limit: Math.min(Math.max(agents.length, 25), 200),
    enabled: selectedBits.length > 0,
  });

  const matchMap = useMemo(() => {
    return new Map((rankedAgents ?? []).map((agent) => [agent.didHex, agent.matchSummary]));
  }, [rankedAgents]);

  const sorted = useMemo(
    () =>
      [...agents].sort((a, b) => {
        const aMatch = matchMap.get(a.did) ?? null;
        const bMatch = matchMap.get(b.did) ?? null;
        const aScore = aMatch?.fitScore ?? compositeScore(a);
        const bScore = bMatch?.fitScore ?? compositeScore(b);
        return bScore - aScore;
      }),
    [agents, matchMap],
  );

  return (
    <section className="border border-ink/10 bg-paper">
      <div className="flex flex-col gap-3 border-b border-ink/10 px-5 py-4 md:flex-row md:items-end md:justify-between md:px-6">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-mute">Registry</div>
          <h2 className="mt-1 font-display text-[22px] tracking-[-0.01em]">Available agents</h2>
          <p className="mt-1 text-sm text-ink/60">
            Compare operators by score, pricing, capability coverage, and recorded reputation.
          </p>
          {selectedBits.length > 0 ? (
            <p className="mt-2 text-xs text-ink/45">
              {isLoadingMatches
                ? 'Refreshing indexed fit scores for the selected capability set...'
                : 'Ranked by indexed fit score for the selected capability set.'}
            </p>
          ) : null}
        </div>
        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink/70">
          {sorted.length} result{sorted.length !== 1 ? 's' : ''}
        </div>
      </div>

      <div className="px-5 py-5 md:px-6">
        {sorted.length === 0 ? (
          <div className="border border-dashed border-ink/20 px-5 py-8 text-center font-mono text-sm text-mute">
            No agents match the current filter set.
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {sorted.map((agent) => {
              const tags = maskToTags(BigInt(agent.capabilityMask));
              const score = compositeScore(agent);
              const matchSummary = matchMap.get(agent.did) ?? null;
              const statusClass = STATUS_STYLE[agent.status] ?? 'text-ink/55 border-ink/15';
              const title = agentTitle(agent);
              const subtitle = agentSubtitle(agent);

              return (
                <article
                  key={agent.address}
                  className="flex h-full flex-col border border-ink/10 bg-paper-2"
                >
                  <div className="flex items-start justify-between gap-4 border-b border-ink/10 px-4 py-4">
                    <div className="min-w-0">
                      <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
                        Agent
                      </div>
                      <a
                        href={`/agents/${agent.did}`}
                        className="mt-2 block font-display text-[22px] leading-tight tracking-[-0.01em] text-ink transition-colors hover:text-ink/70"
                      >
                        {title}
                      </a>
                      <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.08em] text-ink/55">
                        {subtitle}
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] ${statusClass}`}
                    >
                      {agent.status}
                    </span>
                  </div>

                  <div className="flex flex-1 flex-col gap-4 px-4 py-4">
                    {tags.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {tags.slice(0, 4).map((tag) => (
                          <span
                            key={tag}
                            className="border border-ink/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink/65"
                          >
                            {tag}
                          </span>
                        ))}
                        {tags.length > 4 ? (
                          <span className="px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-mute">
                            +{tags.length - 4}
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="grid gap-0 border border-ink/10 sm:grid-cols-3">
                      <StatCell
                        label={matchSummary ? 'Fit' : 'Score'}
                        value={
                          matchSummary
                            ? toPct(matchSummary.fitScore)
                            : Math.round(score).toLocaleString()
                        }
                      />
                      <StatCell label="Price" value={`${fmtSol(agent.priceLamports)} SOL`} />
                      <StatCell label="Jobs" value={String(agent.jobsCompleted)} />
                    </div>

                    <div className="grid gap-0 border border-ink/10 sm:grid-cols-3">
                      <StatCell
                        label={matchSummary ? 'Coverage' : 'Quality'}
                        value={
                          matchSummary
                            ? `${Math.round(matchSummary.coverageBps / 100)}%`
                            : agent.reputation.quality.toLocaleString()
                        }
                      />
                      <StatCell
                        label={matchSummary ? 'Cap Rep' : 'Time'}
                        value={
                          matchSummary
                            ? toPct(matchSummary.capabilityReputationComposite)
                            : agent.reputation.timeliness.toLocaleString()
                        }
                      />
                      <StatCell label="Stake" value={`${fmtSol(agent.stakeAmount)} SOL`} />
                    </div>

                    {matchSummary ? (
                      <div className="border border-ink/10 bg-paper px-3 py-3 text-sm text-ink/60">
                        {explainMatch(matchSummary)}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => onHire(agent)}
                      disabled={agent.status !== 'active'}
                      className="mt-auto inline-flex h-11 items-center justify-center bg-ink px-4 font-mono text-[11px] uppercase tracking-[0.08em] text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Hire agent
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-r border-ink/10 px-3 py-3 last:border-r-0 sm:border-b-0">
      <div className="font-mono text-[10px] uppercase tracking-widest text-mute">{label}</div>
      <div className="mt-2 font-mono text-[12px] text-ink">{value}</div>
    </div>
  );
}
