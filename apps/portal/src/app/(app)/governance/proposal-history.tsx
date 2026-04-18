'use client';

import { useState, useMemo } from 'react';
import {
  type ProposalRow,
  categoryKey,
  CATEGORY_LABELS,
  statusLabel,
  statusColor,
  truncateKey,
  FILTER_TYPES,
} from './types';

interface Props {
  proposals: ProposalRow[];
}

function VoteBar({ proposal }: { proposal: ProposalRow }) {
  const total = proposal.forWeight + proposal.againstWeight + proposal.abstainWeight;
  if (total === 0n) return <span className="text-ink/30">--</span>;

  const pctFor = Number((proposal.forWeight * 100n) / total);
  const pctAgainst = Number((proposal.againstWeight * 100n) / total);

  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 rounded-full bg-ink/10 overflow-hidden flex">
        <div className="h-full bg-lime" style={{ width: `${pctFor}%` }} />
        <div className="h-full bg-red-400" style={{ width: `${pctAgainst}%` }} />
      </div>
      <span className="text-[10px] text-ink/50 w-8 text-right">{pctFor}%</span>
    </div>
  );
}

export function ProposalHistory({ proposals }: Props) {
  const [filter, setFilter] = useState('all');

  const filtered = useMemo(() => {
    if (filter === 'all') return proposals;
    return proposals.filter((p) => categoryKey(p.category) === filter);
  }, [proposals, filter]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => b.createdAt - a.createdAt),
    [filtered],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {FILTER_TYPES.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
              filter === f.value
                ? 'bg-ink/10 text-ink font-medium'
                : 'text-ink/50 hover:text-ink/70'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <div className="border border-ink/10 p-8 text-center">
          <p className="text-sm text-ink/50">No past proposals</p>
        </div>
      ) : (
        <div className="rounded border border-ink/10 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-ink/5 text-ink/60">
              <tr>
                <th className="text-left px-3 py-2 font-medium">ID</th>
                <th className="text-left px-3 py-2 font-medium">Category</th>
                <th className="text-left px-3 py-2 font-medium">Proposer</th>
                <th className="text-left px-3 py-2 font-medium">Result</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.address.toBase58()} className="border-t border-ink/5 hover:bg-ink/[0.02]">
                  <td className="px-3 py-2 font-mono">#{p.proposalId.toString()}</td>
                  <td className="px-3 py-2">{CATEGORY_LABELS[categoryKey(p.category)] ?? '--'}</td>
                  <td className="px-3 py-2 font-mono">{truncateKey(p.proposer)}</td>
                  <td className="px-3 py-2">
                    <VoteBar proposal={p} />
                  </td>
                  <td className={`px-3 py-2 font-medium ${statusColor(p.status)}`}>
                    {statusLabel(p.status)}
                  </td>
                  <td className="px-3 py-2 text-ink/50">
                    {new Date(p.createdAt * 1000).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
