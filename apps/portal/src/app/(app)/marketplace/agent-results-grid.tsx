'use client';

import { useMemo } from 'react';
import {
  useDiscoveryAgents,
  useDiscoveryTaskMatches,
  type DiscoveryAgentMatchSummary,
} from '@saep/sdk-ui';
import type { SerializedAgent, SerializedTask } from '@/lib/agent-serializer';
import { getPortalIndexerUrl } from '@/lib/indexer-url';
import { CAPABILITY_LABELS, maskToTags } from '../dashboard/capability-tags';
import {
  agentSubtitle,
  agentTitle,
  avgReputationScore,
  compositeScore,
  fmtSol,
} from './agent-card-utils';

const STATUS_STYLE: Record<string, string> = {
  active: 'text-lime border-lime/30',
  paused: 'text-amber-600 border-amber-500/30',
  suspended: 'text-danger border-danger/30',
  deregistered: 'text-mute border-ink/15',
};

interface Props {
  agents: SerializedAgent[];
  selectedBits: number[];
  selectedTask: SerializedTask | null;
  selectedTaskTitle: string | null;
  sortMode: 'best_fit' | 'reputation' | 'price_asc' | 'recent';
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

function summarizeBits(bits: number[]): string | null {
  if (bits.length === 0) return null;
  const labels = bits
    .slice(0, 2)
    .map((bit) => CAPABILITY_LABELS[bit] ?? `bit ${bit}`)
    .join(', ');
  return bits.length > 2 ? `${labels} +${bits.length - 2}` : labels;
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
  const missing = summarizeBits(matchSummary.missingCapabilityBits);
  if (missing) {
    segments.push(`missing ${missing}`);
  }
  return segments.join(' • ');
}

export function AgentResultsGrid({
  agents,
  selectedBits,
  selectedTask,
  selectedTaskTitle,
  sortMode,
  onHire,
}: Props) {
  const capabilityMaskHex = useMemo(() => selectedMaskHex(selectedBits), [selectedBits]);

  const { data: taskMatches, isLoading: isLoadingTaskMatches } = useDiscoveryTaskMatches({
    indexerUrl: INDEXER_URL,
    taskIdHex: selectedTask?.taskId ?? null,
    limit: Math.min(Math.max(agents.length, 25), 200),
    enabled: Boolean(selectedTask?.taskId),
  });

  const { data: rankedAgents, isLoading: isLoadingCapabilityMatches } = useDiscoveryAgents({
    indexerUrl: INDEXER_URL,
    capabilityMaskHex,
    limit: Math.min(Math.max(agents.length, 25), 200),
    enabled: !selectedTask && selectedBits.length > 0,
  });

  const capabilityMatchMap = useMemo(
    () => new Map((rankedAgents ?? []).map((agent) => [agent.didHex, agent.matchSummary])),
    [rankedAgents],
  );
  const capabilityRankMap = useMemo(
    () => new Map((rankedAgents ?? []).map((agent, index) => [agent.didHex, index])),
    [rankedAgents],
  );
  const taskMatchMap = useMemo(
    () =>
      new Map(
        (taskMatches?.items ?? []).map((candidate) => [candidate.didHex, candidate.matchSummary]),
      ),
    [taskMatches],
  );
  const taskRankMap = useMemo(
    () => new Map((taskMatches?.items ?? []).map((candidate, index) => [candidate.didHex, index])),
    [taskMatches],
  );

  const contextMatchMap = selectedTask ? taskMatchMap : capabilityMatchMap;
  const contextRankMap = selectedTask ? taskRankMap : capabilityRankMap;
  const hasRecommendationContext = Boolean(selectedTask) || selectedBits.length > 0;
  const showLoadingMatches = selectedTask ? isLoadingTaskMatches : isLoadingCapabilityMatches;

  const sorted = useMemo(() => {
    const compareDesc = (a: number, b: number) => b - a;
    const compareAsc = (a: number, b: number) => a - b;

    return [...agents].sort((a, b) => {
      const aRank = contextRankMap.get(a.did);
      const bRank = contextRankMap.get(b.did);
      const aHasMatch = aRank != null;
      const bHasMatch = bRank != null;

      if (hasRecommendationContext && aHasMatch !== bHasMatch) {
        return aHasMatch ? -1 : 1;
      }

      if (sortMode === 'best_fit' && aHasMatch && bHasMatch && aRank !== bRank) {
        return aRank - bRank;
      }

      if (sortMode === 'reputation') {
        const rep = compareDesc(avgReputationScore(a), avgReputationScore(b));
        if (rep !== 0) return rep;
      } else if (sortMode === 'price_asc') {
        const price = compareAsc(Number(a.priceLamports), Number(b.priceLamports));
        if (price !== 0) return price;
      } else if (sortMode === 'recent') {
        const recent = compareDesc(a.lastActive, b.lastActive);
        if (recent !== 0) return recent;
      }

      const aMatch = contextMatchMap.get(a.did) ?? null;
      const bMatch = contextMatchMap.get(b.did) ?? null;
      const aScore = aMatch?.fitScore ?? compositeScore(a);
      const bScore = bMatch?.fitScore ?? compositeScore(b);
      const fit = compareDesc(aScore, bScore);
      if (fit !== 0) return fit;

      return compareDesc(avgReputationScore(a), avgReputationScore(b));
    });
  }, [agents, contextMatchMap, contextRankMap, hasRecommendationContext, sortMode]);

  return (
    <section className="border border-ink/10 bg-paper">
      <div className="flex flex-col gap-3 border-b border-ink/10 px-5 py-4 md:flex-row md:items-end md:justify-between md:px-6">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-mute">Registry</div>
          <h2 className="mt-1 font-display text-[22px] tracking-[-0.01em]">Available agents</h2>
          <p className="mt-1 text-sm text-ink/60">
            Compare operators by score, pricing, capability coverage, and recorded reputation.
          </p>
          {selectedTaskTitle ? (
            <p className="mt-2 text-xs text-ink/45">
              {showLoadingMatches
                ? `Ranking agents against ${selectedTaskTitle}...`
                : `Task-led mode is active for ${selectedTaskTitle}. Stronger fits float to the top.`}
            </p>
          ) : selectedBits.length > 0 ? (
            <p className="mt-2 text-xs text-ink/45">
              {showLoadingMatches
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
              const matchSummary = contextMatchMap.get(agent.did) ?? null;
              const matchRank = contextRankMap.get(agent.did);
              const statusClass = STATUS_STYLE[agent.status] ?? 'text-ink/55 border-ink/15';

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
                      {matchRank != null ? (
                        <div className="mt-2 inline-flex items-center border border-ink/15 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink/65">
                          #{matchRank + 1} {matchRank === 0 ? 'best fit' : 'ranked match'}
                        </div>
                      ) : null}
                      <a
                        href={`/agents/${agent.did}`}
                        className="mt-2 block font-display text-[22px] leading-tight tracking-[-0.01em] text-ink transition-colors hover:text-ink/70"
                      >
                        {agentTitle(agent)}
                      </a>
                      <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.08em] text-ink/55">
                        {agentSubtitle(agent)}
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
                        label={matchSummary ? 'Fit' : sortMode === 'reputation' ? 'Rep' : 'Score'}
                        value={
                          matchSummary
                            ? toPct(matchSummary.fitScore)
                            : sortMode === 'reputation'
                              ? toPct(avgReputationScore(agent))
                              : Math.round(compositeScore(agent)).toLocaleString()
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
                        <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
                          Why this agent fits
                        </div>
                        <div className="mt-2">{explainMatch(matchSummary)}</div>
                      </div>
                    ) : hasRecommendationContext ? (
                      <div className="border border-ink/10 bg-paper px-3 py-3 text-sm text-ink/45">
                        No indexed fit explanation surfaced for this agent under the current
                        recommendation context.
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
