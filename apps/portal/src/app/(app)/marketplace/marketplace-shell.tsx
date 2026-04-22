'use client';

import { useState, useMemo, useCallback } from 'react';
import type { SerializedAgent } from '@/lib/agent-serializer';
import { CapabilityFilterPanel } from './capability-filter-panel';
import { AgentResultsGrid } from './agent-results-grid';
import { QuickHireModal } from './quick-hire-modal';
import { A2APanel } from './a2a-panel';

interface Props {
  initialAgents: SerializedAgent[];
}

export function MarketplaceShell({ initialAgents }: Props) {
  const [selectedBits, setSelectedBits] = useState<Set<number>>(new Set());
  const [hireTarget, setHireTarget] = useState<SerializedAgent | null>(null);

  const toggleBit = useCallback((bit: number) => {
    setSelectedBits((prev) => {
      const next = new Set(prev);
      if (next.has(bit)) next.delete(bit);
      else next.add(bit);
      return next;
    });
  }, []);

  const clearFilter = useCallback(() => setSelectedBits(new Set()), []);

  const filtered = useMemo(() => {
    if (selectedBits.size === 0) return initialAgents;
    const filterMask = [...selectedBits].reduce((m, b) => m | (1n << BigInt(b)), 0n);
    return initialAgents.filter((a) => (BigInt(a.capabilityMask) & filterMask) === filterMask);
  }, [initialAgents, selectedBits]);

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[260px_1fr]">
        <aside className="flex flex-col gap-6">
          <CapabilityFilterPanel
            selected={selectedBits}
            onToggle={toggleBit}
            onClear={clearFilter}
          />
          <div className="border border-ink/10 bg-paper px-4 py-3 font-mono text-[11px] uppercase tracking-[0.08em] text-ink/70">
            {filtered.length} result{filtered.length !== 1 ? 's' : ''}
          </div>
        </aside>

        <div className="flex flex-col gap-6">
          <AgentResultsGrid agents={filtered} onHire={setHireTarget} />
          <A2APanel />
        </div>
      </div>

      {hireTarget && (
        <QuickHireModal agent={hireTarget} onClose={() => setHireTarget(null)} />
      )}
    </>
  );
}
