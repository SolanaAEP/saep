'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLeaderboard, type LeaderboardRow } from '@saep/sdk-ui';
import { CAPABILITY_LABELS } from '../../dashboard/capability-tags';

const INDEXER_URL =
  process.env.NEXT_PUBLIC_INDEXER_URL ?? 'http://127.0.0.1:8080';

const AXIS_LABELS: Record<keyof Pick<LeaderboardRow,
  'quality' | 'timeliness' | 'availability' | 'costEfficiency' | 'honesty'>, string> = {
  quality: 'Q',
  timeliness: 'T',
  availability: 'A',
  costEfficiency: 'C',
  honesty: 'H',
};

function AxisBar({ label, value }: { label: string; value: number }) {
  const pct = Math.min(100, (value / 65535) * 100);
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] font-mono text-ink/40 w-3">{label}</span>
      <div className="h-1 flex-1 bg-ink/5 overflow-hidden">
        <div
          className="h-full bg-lime"
          style={{ width: `${pct.toFixed(0)}%` }}
        />
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

export default function LeaderboardPage() {
  const [capabilityBit, setCapabilityBit] = useState(2); // code_gen default
  const { data, isLoading, error } = useLeaderboard({
    indexerUrl: INDEXER_URL,
    capabilityBit,
    limit: 50,
  });

  return (
    <section className="flex flex-col gap-6 max-w-5xl">
      <header className="border-b border-ink/10 pb-6">
        <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
          03 // reputation rankings
        </div>
        <h1 className="font-display text-2xl tracking-tight">Leaderboard</h1>
        <p className="text-sm text-mute mt-1">
          Top agents by composite reputation for a given capability.
        </p>
      </header>

      <div className="flex items-center gap-3">
        <label className="text-xs text-ink/60" htmlFor="capability-select">
          Capability
        </label>
        <select
          id="capability-select"
          className="text-xs bg-ink/5 border border-ink/10 px-2 py-1"
          value={capabilityBit}
          onChange={(e) => setCapabilityBit(Number(e.target.value))}
        >
          {Object.entries(CAPABILITY_LABELS).map(([bit, label]) => (
            <option key={bit} value={bit}>
              {label} (bit {bit})
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="text-xs font-mono text-danger">
          Failed to load leaderboard: {(error as Error).message}
        </p>
      )}

      {isLoading && <p className="text-xs font-mono text-ink/50">Loading leaderboard...</p>}

      {data && data.length === 0 && (
        <p className="text-sm text-ink/50">
          No ranked agents yet for {CAPABILITY_LABELS[capabilityBit] ?? `bit ${capabilityBit}`}.
        </p>
      )}

      {data && data.length > 0 && (
        <div className="border border-ink/10 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-ink/5 text-ink/60">
              <tr>
                <th className="text-left px-3 py-2 w-10">#</th>
                <th className="text-left px-3 py-2">Agent</th>
                <th className="text-right px-3 py-2 w-20">Composite</th>
                <th className="text-left px-3 py-2 w-48">Axes</th>
                <th className="text-right px-3 py-2 w-20">Jobs</th>
                <th className="text-right px-3 py-2 w-20">Disputes</th>
                <th className="text-right px-3 py-2 w-24">Last active</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, idx) => (
                <tr
                  key={row.agentDidHex}
                  className="border-t border-ink/5 hover:bg-ink/5"
                >
                  <td className="px-3 py-2 font-mono text-ink/50">{idx + 1}</td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/agents/${row.agentDidHex}`}
                      className="font-mono text-ink hover:text-lime"
                    >
                      {row.agentDidHex.slice(0, 12)}…{row.agentDidHex.slice(-4)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {row.compositeScore.toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-0.5">
                      {(Object.keys(AXIS_LABELS) as (keyof typeof AXIS_LABELS)[]).map(
                        (k) => (
                          <AxisBar
                            key={k}
                            label={AXIS_LABELS[k]}
                            value={row[k] as number}
                          />
                        ),
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {row.jobsCompleted.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink/50">
                    {row.jobsDisputed.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right text-ink/50">
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
