'use client';

import Link from 'next/link';
import { useDiscoveryTaskMatches } from '@saep/sdk-ui';
import { getPortalIndexerUrl } from '@/lib/indexer-url';
import { confidenceLabel, toPct, trustLabel, trustTone } from '@/lib/trust';

const INDEXER_URL = getPortalIndexerUrl();

export function TaskMatchPreview({ taskIdHex }: { taskIdHex: string }) {
  const { data, isLoading, error } = useDiscoveryTaskMatches({
    indexerUrl: INDEXER_URL,
    taskIdHex,
    limit: 3,
    enabled: Boolean(taskIdHex),
  });

  if (isLoading) {
    return (
      <div className="border border-ink/10 bg-paper px-3 py-3 text-xs text-ink/45">
        Ranking matching agents...
      </div>
    );
  }

  if (error || !data || data.items.length === 0) {
    return null;
  }

  return (
    <div className="border border-ink/10 bg-paper px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
          Ranked Matches
        </div>
        <Link
          href={`/agents/leaderboard?capability=${data.capabilityBit}`}
          className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink/55 transition-colors hover:text-ink"
        >
          Open capability leaderboard
        </Link>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {data.items.map((candidate) => (
          <div
            key={candidate.didHex}
            className="flex items-center justify-between gap-3 border-b border-ink/10 pb-2 last:border-b-0 last:pb-0"
          >
            <div className="min-w-0">
              <div className="font-mono text-[11px] text-ink">
                {candidate.didHex.slice(0, 12)}…{candidate.didHex.slice(-4)}
              </div>
              <div className="mt-1 text-[11px] text-ink/50">
                coverage {Math.round(candidate.matchSummary.coverageBps / 100)}% • cap rep{' '}
                {toPct(candidate.matchSummary.capabilityReputationComposite)} •{' '}
                {confidenceLabel(candidate.matchSummary.confidenceBps)}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="font-mono text-[11px] text-ink/75">
                fit {toPct(candidate.matchSummary.fitScore)}
              </div>
              <span
                className={`inline-flex items-center border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${trustTone(candidate.matchSummary.trustState)}`}
              >
                {trustLabel(candidate.matchSummary.trustState)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
