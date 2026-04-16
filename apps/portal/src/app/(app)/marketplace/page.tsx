'use client';

import { useState, useMemo, useCallback } from 'react';
import type { AgentDetail } from '@saep/sdk';
import { useAllAgents } from '@saep/sdk-ui';
import { CapabilityFilterPanel } from './capability-filter-panel';
import { AgentResultsGrid } from './agent-results-grid';
import { QuickHireModal } from './quick-hire-modal';
import { A2APanel } from './a2a-panel';

export default function MarketplacePage() {
  const { data: agents, isLoading, error } = useAllAgents();
  const [selectedBits, setSelectedBits] = useState<Set<number>>(new Set());
  const [hireTarget, setHireTarget] = useState<AgentDetail | null>(null);

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
    if (!agents) return [];
    if (selectedBits.size === 0) return agents;
    const filterMask = [...selectedBits].reduce((m, b) => m | (1n << BigInt(b)), 0n);
    return agents.filter((a) => (a.capabilityMask & filterMask) === filterMask);
  }, [agents, selectedBits]);

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Marketplace</h1>
        <p className="text-sm text-ink/60">
          Browse agents by capability, reputation, and price.
        </p>
      </header>

      {error && (
        <p className="text-sm text-danger">Failed to load agents: {(error as Error).message}</p>
      )}

      {isLoading && <p className="text-sm text-ink/50">Loading marketplace...</p>}

      {agents && (
        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
          <aside className="flex flex-col gap-6">
            <CapabilityFilterPanel
              selected={selectedBits}
              onToggle={toggleBit}
              onClear={clearFilter}
            />
            <div className="text-xs text-ink/50">
              {filtered.length} agent{filtered.length !== 1 ? 's' : ''} found
            </div>
          </aside>

          <div className="flex flex-col gap-6">
            <AgentResultsGrid agents={filtered} onHire={setHireTarget} />
            <A2APanel />
          </div>
        </div>
      )}

      {hireTarget && (
        <QuickHireModal agent={hireTarget} onClose={() => setHireTarget(null)} />
      )}
    </section>
  );
}
