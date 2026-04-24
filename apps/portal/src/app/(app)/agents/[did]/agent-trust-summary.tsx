'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useAgentReputation } from '@saep/sdk-ui';
import { getPortalIndexerUrl } from '@/lib/indexer-url';
import { confidenceLabel, explainLeaderboardRow, toPct, trustLabel, trustTone } from '@/lib/trust';
import { CAPABILITY_LABELS } from '../../dashboard/capability-tags';

const INDEXER_URL = getPortalIndexerUrl();

export function AgentTrustSummary({ didHex }: { didHex: string }) {
  const { data, isLoading, error } = useAgentReputation({
    indexerUrl: INDEXER_URL,
    agentDidHex: didHex,
  });

  const rows = useMemo(
    () =>
      [...(data ?? [])]
        .sort((a, b) => b.trustScore - a.trustScore || b.confidenceBps - a.confidenceBps)
        .slice(0, 4),
    [data],
  );

  return (
    <section className="border border-ink/10 bg-paper">
      <header className="border-b border-ink/10 px-4 py-4">
        <div className="font-mono text-[10px] uppercase tracking-widest text-mute">Trust</div>
        <div className="mt-1 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-[22px] tracking-[-0.01em]">Capability trust</h2>
            <p className="mt-1 text-sm text-ink/60">
              Best capability slices for this agent once liveness, dispute pressure, and history
              depth are folded into the ranking.
            </p>
          </div>
        </div>
      </header>

      <div className="px-4 py-4">
        {isLoading ? (
          <p className="text-sm text-ink/50">Loading trust summary...</p>
        ) : error ? (
          <p className="border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            Failed to load indexed trust data: {(error as Error).message}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-ink/50">
            No indexed capability trust rows yet for this agent.
          </p>
        ) : (
          <div className="grid gap-3">
            {rows.map((row) => (
              <div key={row.capabilityBit} className="border border-ink/10 bg-paper-2 px-3 py-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
                      {CAPABILITY_LABELS[row.capabilityBit] ?? `bit ${row.capabilityBit}`}
                    </div>
                    <div className="mt-2 text-sm text-ink/60">{explainLeaderboardRow(row)}</div>
                  </div>
                  <div className="flex flex-col items-start gap-2 md:items-end">
                    <span
                      className={`inline-flex items-center border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] ${trustTone(row.trustState)}`}
                    >
                      {trustLabel(row.trustState)}
                    </span>
                    <div className="font-mono text-sm text-ink">
                      trust {toPct(row.trustScore)} • {confidenceLabel(row.confidenceBps)}
                    </div>
                    <Link
                      href={`/agents/leaderboard?capability=${row.capabilityBit}`}
                      className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink/55 transition-colors hover:text-ink"
                    >
                      Open capability leaderboard
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
