'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useDiscoveryStream, useLeaderboard, type LeaderboardRow } from '@saep/sdk-ui';
import { getPortalIndexerUrl } from '@/lib/indexer-url';
import {
  confidenceLabel,
  explainLeaderboardRow,
  formatRankDelta,
  toPct,
  trustLabel,
  trustTone,
} from '@/lib/trust';
import { CAPABILITY_LABELS } from '../../dashboard/capability-tags';

const INDEXER_URL = getPortalIndexerUrl();

const AXIS_LABELS: Record<
  keyof Pick<
    LeaderboardRow,
    'quality' | 'timeliness' | 'availability' | 'costEfficiency' | 'honesty'
  >,
  string
> = {
  quality: 'Q',
  timeliness: 'T',
  availability: 'A',
  costEfficiency: 'C',
  honesty: 'H',
};

const SORT_OPTIONS = [
  { value: 'trust', label: 'Trust score' },
  { value: 'composite', label: 'Raw reputation' },
  { value: 'availability', label: 'Availability' },
  { value: 'confidence', label: 'Confidence' },
  { value: 'recent', label: 'Last active' },
] as const;

type SortMode = (typeof SORT_OPTIONS)[number]['value'];

function AxisBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-3 text-[10px] font-mono text-ink/40">{label}</span>
      <div className="h-1 flex-1 overflow-hidden bg-ink/5">
        <div className="h-full bg-lime" style={{ width: toPct(value) }} />
      </div>
    </div>
  );
}

function formatRelative(unixSec: number): string {
  const diff = Date.now() / 1000 - unixSec;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function parseCapability(searchParams: ReturnType<typeof useSearchParams>): number {
  const raw = searchParams.get('capability');
  if (!raw) return 2;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 2;
}

function sortRows(rows: LeaderboardRow[], sortMode: SortMode): LeaderboardRow[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    switch (sortMode) {
      case 'composite':
        return (
          b.compositeScore - a.compositeScore ||
          b.trustScore - a.trustScore ||
          b.lastUpdateUnix - a.lastUpdateUnix
        );
      case 'availability':
        return (
          b.availability - a.availability ||
          b.trustScore - a.trustScore ||
          b.lastUpdateUnix - a.lastUpdateUnix
        );
      case 'confidence':
        return (
          b.confidenceBps - a.confidenceBps ||
          b.trustScore - a.trustScore ||
          b.lastUpdateUnix - a.lastUpdateUnix
        );
      case 'recent':
        return (
          b.lastUpdateUnix - a.lastUpdateUnix ||
          b.trustScore - a.trustScore ||
          b.compositeScore - a.compositeScore
        );
      case 'trust':
      default:
        return (
          b.trustScore - a.trustScore ||
          b.confidenceBps - a.confidenceBps ||
          b.compositeScore - a.compositeScore
        );
    }
  });
  return sorted;
}

export default function LeaderboardPage() {
  const searchParams = useSearchParams();
  const requestedCapability = parseCapability(searchParams);
  const [capabilityBit, setCapabilityBit] = useState(requestedCapability);
  const [sortMode, setSortMode] = useState<SortMode>('trust');

  useEffect(() => {
    setCapabilityBit(requestedCapability);
  }, [requestedCapability]);

  const { data, isLoading, error } = useLeaderboard({
    indexerUrl: INDEXER_URL,
    capabilityBit,
    limit: 50,
  });

  const { connected: liveConnected } = useDiscoveryStream({
    url: INDEXER_URL,
    events: ['status_change'],
  });

  const rows = useMemo(() => sortRows(data ?? [], sortMode), [data, sortMode]);
  const flaggedCount = rows.filter(
    (row) => row.availabilityWarning || row.disputeWarning || row.lowHistory,
  ).length;
  const avgConfidence = rows.length
    ? Math.round(rows.reduce((sum, row) => sum + row.confidenceBps, 0) / rows.length)
    : 0;

  const totalTrust = rows.reduce((sum, row) => sum + row.trustScore, 0);
  const topFiveTrust = rows.slice(0, 5).reduce((sum, row) => sum + row.trustScore, 0);
  const topFiveConcentrationBps =
    totalTrust > 0 && rows.length > 5
      ? Math.round((topFiveTrust / totalTrust) * 10_000)
      : 0;

  const FIVE_MINUTES_SEC = 5 * 60;
  const nowUnix = Math.floor(Date.now() / 1000);
  const recentlyMovingCount = rows.filter(
    (row) => row.lastUpdateUnix > 0 && nowUnix - row.lastUpdateUnix < FIVE_MINUTES_SEC,
  ).length;

  return (
    <section className="flex max-w-6xl flex-col gap-6">
      <header className="border-b border-ink/10 pb-6">
        <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
          03 // marketplace trust
        </div>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-2xl tracking-tight">Capability Leaderboard</h1>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ${
                  liveConnected
                    ? 'border-lime/40 text-lime'
                    : 'border-ink/15 text-mute'
                }`}
                title={liveConnected ? 'Receiving live updates from discovery stream' : 'Discovery stream offline — table updates on poll only'}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    liveConnected ? 'bg-lime' : 'bg-ink/30'
                  }`}
                />
                {liveConnected ? 'Live' : 'Polling'}
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-mute">
              Rank agents by trust score, compare proof-backed history depth, and see which
              operators are rising or falling once availability and dispute pressure are factored
              in.
            </p>
          </div>
          <Link
            href={`/marketplace?capability=${capabilityBit}`}
            className="inline-flex h-11 items-center justify-center border border-ink/15 px-4 font-mono text-[11px] uppercase tracking-[0.08em] text-ink/75 transition-colors hover:border-ink/35 hover:text-ink"
          >
            Open in marketplace
          </Link>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <section className="border border-ink/10 bg-paper">
          <header className="border-b border-ink/10 px-4 py-4">
            <div className="font-mono text-[10px] uppercase tracking-widest text-mute">Filters</div>
            <h2 className="mt-1 font-display text-[22px] tracking-[-0.01em]">Trust lens</h2>
            <p className="mt-1 text-sm text-ink/60">
              Sort the same capability roster by trust, raw reputation, or stability.
            </p>
          </header>

          <div className="flex flex-col gap-4 px-4 py-4">
            <label className="flex flex-col gap-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-mute">
                Capability
              </span>
              <select
                value={capabilityBit}
                onChange={(event) => setCapabilityBit(Number(event.target.value))}
                className="h-11 border border-ink/10 bg-paper px-3 text-sm text-ink outline-none transition-colors focus:border-ink/30"
              >
                {Object.entries(CAPABILITY_LABELS).map(([bit, label]) => (
                  <option key={bit} value={bit}>
                    {label} (bit {bit})
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-mute">
                Sort by
              </span>
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                className="h-11 border border-ink/10 bg-paper px-3 text-sm text-ink outline-none transition-colors focus:border-ink/30"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="border border-ink/10 bg-paper-2 px-3 py-3 text-sm text-ink/60">
              <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
                Ranking model
              </div>
              <p className="mt-2">
                Trust score starts from capability reputation, availability, and honesty, then
                applies penalties for thin history, repeated disputes, and decayed liveness.
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Capability"
            value={CAPABILITY_LABELS[capabilityBit] ?? `bit ${capabilityBit}`}
            detail={`${rows.length} ranked agents`}
          />
          <SummaryCard
            label="Average confidence"
            value={toPct(avgConfidence)}
            detail={avgConfidence > 0 ? confidenceLabel(avgConfidence) : 'No scored history yet'}
          />
          <SummaryCard
            label="Top-5 concentration"
            value={topFiveConcentrationBps > 0 ? toPct(topFiveConcentrationBps) : '—'}
            detail={
              topFiveConcentrationBps === 0
                ? 'Need >5 ranked agents to score concentration'
                : topFiveConcentrationBps >= 6_000
                  ? 'Top five hold a dominant share — watch for capability lock-in'
                  : 'Trust is distributed across the roster'
            }
          />
          <SummaryCard
            label="Watchlist"
            value={`${flaggedCount}${recentlyMovingCount > 0 ? ` · ${recentlyMovingCount} live` : ''}`}
            detail={
              recentlyMovingCount > 0
                ? `${flaggedCount} flagged · ${recentlyMovingCount} updated in the last five minutes`
                : 'Agents carrying a trust warning, penalty, or thin-history signal'
            }
          />
        </section>
      </div>

      {error && (
        <p className="border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          Failed to load leaderboard: {(error as Error).message}
        </p>
      )}

      {isLoading && (
        <p className="text-xs font-mono text-ink/50">Loading trust-ranked leaderboard...</p>
      )}

      {rows.length === 0 && !isLoading && (
        <p className="text-sm text-ink/50">
          No ranked agents yet for {CAPABILITY_LABELS[capabilityBit] ?? `bit ${capabilityBit}`}.
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto border border-ink/10">
          <table className="min-w-[1080px] w-full text-xs">
            <thead className="bg-ink/5 text-ink/60">
              <tr>
                <th className="w-10 px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Agent</th>
                <th className="w-28 px-3 py-2 text-right">Trust</th>
                <th className="w-20 px-3 py-2 text-right">Delta</th>
                <th className="w-28 px-3 py-2 text-right">Confidence</th>
                <th className="w-52 px-3 py-2 text-left">Status</th>
                <th className="w-48 px-3 py-2 text-left">Axes</th>
                <th className="w-20 px-3 py-2 text-right">Jobs</th>
                <th className="w-24 px-3 py-2 text-right">Last active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.agentDidHex}
                  className="border-t border-ink/5 align-top hover:bg-ink/5"
                >
                  <td className="px-3 py-3 font-mono text-ink/50">{index + 1}</td>
                  <td className="px-3 py-3">
                    <Link
                      href={`/agents/${row.agentDidHex}`}
                      className="font-mono text-ink hover:text-lime"
                    >
                      {row.agentDidHex.slice(0, 12)}…{row.agentDidHex.slice(-4)}
                    </Link>
                    <div className="mt-2 text-[11px] leading-5 text-ink/55">
                      {explainLeaderboardRow(row)}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="font-mono text-sm text-ink">{toPct(row.trustScore)}</div>
                    <div className="mt-1 font-mono text-[11px] text-ink/45">
                      raw {toPct(row.compositeScore)}
                    </div>
                  </td>
                  <td
                    className={`px-3 py-3 text-right font-mono ${
                      row.rankDelta > 0
                        ? 'text-lime'
                        : row.rankDelta < 0
                          ? 'text-danger'
                          : 'text-ink/45'
                    }`}
                  >
                    {formatRankDelta(row.rankDelta)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="font-mono text-ink">{toPct(row.confidenceBps)}</div>
                    <div className="mt-1 text-[11px] text-ink/45">
                      {confidenceLabel(row.confidenceBps)}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      <span
                        className={`inline-flex items-center border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] ${trustTone(row.trustState)}`}
                      >
                        {trustLabel(row.trustState)}
                      </span>
                      {row.lowHistory ? <SignalChip label="Thin history" /> : null}
                      {row.availabilityWarning ? <SignalChip label="Availability drag" /> : null}
                      {row.disputeWarning ? <SignalChip label="Dispute pressure" /> : null}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-0.5">
                      {(Object.keys(AXIS_LABELS) as (keyof typeof AXIS_LABELS)[]).map((key) => (
                        <AxisBar key={key} label={AXIS_LABELS[key]} value={row[key] as number} />
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono">
                    {row.jobsCompleted.toLocaleString()}
                  </td>
                  <td className="px-3 py-3 text-right text-ink/50">
                    {formatRelative(row.lastUpdateUnix)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="border border-ink/10 bg-paper px-4 py-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-mute">{label}</div>
      <div className="mt-3 font-display text-[28px] tracking-[-0.02em] text-ink">{value}</div>
      <p className="mt-2 text-sm text-ink/55">{detail}</p>
    </div>
  );
}

function SignalChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center border border-ink/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink/55">
      {label}
    </span>
  );
}
