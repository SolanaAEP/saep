'use client';

import { useState, useMemo, useCallback, useDeferredValue } from 'react';
import { useRouter } from 'next/navigation';
import { useDiscoveryStream } from '@saep/sdk-ui';
import { findMarketplaceBountyByTaskHash } from '@saep/sdk';
import type { SerializedAgent, SerializedTask } from '@/lib/agent-serializer';
import { getPortalDiscoveryWsUrl } from '@/lib/discovery-ws-url';
import { CapabilityFilterPanel } from './capability-filter-panel';
import { AgentResultsGrid } from './agent-results-grid';
import { QuickHireModal } from './quick-hire-modal';
import { A2APanel } from './a2a-panel';
import { LiveBountiesPanel } from './live-bounties-panel';
import { DiscoveryControlsPanel } from './discovery-controls-panel';
import { agentSearchIndex, avgReputationScore } from './agent-card-utils';

const DISCOVERY_WS_URL = getPortalDiscoveryWsUrl();

interface Props {
  initialAgents: SerializedAgent[];
  tasks: SerializedTask[];
  initialSelectedBits?: number[];
  initialSelectedTaskId?: string | null;
}

export function MarketplaceShell({
  initialAgents,
  tasks,
  initialSelectedBits = [],
  initialSelectedTaskId = null,
}: Props) {
  const [selectedBits, setSelectedBits] = useState<Set<number>>(new Set(initialSelectedBits));
  const [hireTarget, setHireTarget] = useState<SerializedAgent | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    tasks.some((task) => task.taskId === initialSelectedTaskId)
      ? initialSelectedTaskId
      : (tasks[0]?.taskId ?? null),
  );
  const [query, setQuery] = useState('');
  const [minReputation, setMinReputation] = useState(0);
  const [sortMode, setSortMode] = useState<'best_fit' | 'reputation' | 'price_asc' | 'recent'>(
    'best_fit',
  );
  const deferredQuery = useDeferredValue(query);

  const router = useRouter();
  const [pendingNewTasks, setPendingNewTasks] = useState(0);

  useDiscoveryStream({
    url: DISCOVERY_WS_URL,
    events: ['new_task'],
    invalidateLeaderboard: false,
    onMessage: (msg) => {
      if (msg.type === 'new_task') {
        setPendingNewTasks((n) => n + 1);
      }
    },
  });

  const refreshFromServer = useCallback(() => {
    setPendingNewTasks(0);
    router.refresh();
  }, [router]);

  const toggleBit = useCallback((bit: number) => {
    setSelectedBits((prev) => {
      const next = new Set(prev);
      if (next.has(bit)) next.delete(bit);
      else next.add(bit);
      return next;
    });
  }, []);

  const clearFilter = useCallback(() => setSelectedBits(new Set()), []);
  const clearTask = useCallback(() => setSelectedTaskId(null), []);
  const clearAll = useCallback(() => {
    setSelectedBits(new Set());
    setSelectedTaskId(null);
    setQuery('');
    setMinReputation(0);
    setSortMode('best_fit');
  }, []);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.taskId === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  );

  const selectedTaskTitle = useMemo(() => {
    if (!selectedTask) return null;
    const bounty = findMarketplaceBountyByTaskHash(
      selectedTask.catalogHash ?? selectedTask.taskHash,
    );
    return bounty?.title ?? `Bounty ${selectedTask.taskId.slice(0, 10)}…`;
  }, [selectedTask]);

  const filtered = useMemo(() => {
    const filterMask =
      selectedBits.size === 0
        ? null
        : [...selectedBits].reduce((m, b) => m | (1n << BigInt(b)), 0n);
    const normalizedQuery = deferredQuery.trim().toLowerCase();

    return initialAgents.filter((agent) => {
      if (filterMask != null && (BigInt(agent.capabilityMask) & filterMask) !== filterMask) {
        return false;
      }
      if (minReputation > 0 && avgReputationScore(agent) < minReputation) {
        return false;
      }
      if (normalizedQuery && !agentSearchIndex(agent).includes(normalizedQuery)) {
        return false;
      }
      return true;
    });
  }, [deferredQuery, initialAgents, minReputation, selectedBits]);

  const activeFilterCount =
    selectedBits.size +
    (selectedTask ? 1 : 0) +
    (query.trim() ? 1 : 0) +
    (minReputation > 0 ? 1 : 0);

  return (
    <>
      <div className="flex flex-col gap-6">
        {pendingNewTasks > 0 && (
          <button
            type="button"
            onClick={refreshFromServer}
            className="flex items-center justify-between border border-lime/40 bg-lime/5 px-4 py-3 text-left transition-colors hover:bg-lime/10"
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-lime">
              {pendingNewTasks} new {pendingNewTasks === 1 ? 'bounty' : 'bounties'} available
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-lime/80">
              Refresh →
            </span>
          </button>
        )}
        <LiveBountiesPanel
          tasks={tasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={setSelectedTaskId}
        />

        <div className="grid gap-6 xl:grid-cols-[300px_1fr]">
          <aside className="flex flex-col gap-6">
            <CapabilityFilterPanel
              selected={selectedBits}
              onToggle={toggleBit}
              onClear={clearFilter}
            />
            <DiscoveryControlsPanel
              query={query}
              minReputation={minReputation}
              sortMode={sortMode}
              selectedTaskTitle={selectedTaskTitle}
              activeFilterCount={activeFilterCount}
              onQueryChange={setQuery}
              onMinReputationChange={setMinReputation}
              onSortModeChange={setSortMode}
              onClearAll={clearAll}
              onClearTask={clearTask}
            />
            <div className="border border-ink/10 bg-paper px-4 py-3 font-mono text-[11px] uppercase tracking-[0.08em] text-ink/70">
              {filtered.length} result{filtered.length !== 1 ? 's' : ''}
            </div>
          </aside>

          <div className="flex flex-col gap-6">
            <AgentResultsGrid
              agents={filtered}
              selectedBits={[...selectedBits].sort((a, b) => a - b)}
              selectedTask={selectedTask}
              selectedTaskTitle={selectedTaskTitle}
              sortMode={sortMode}
              onHire={setHireTarget}
            />
            <A2APanel />
          </div>
        </div>
      </div>

      {hireTarget && <QuickHireModal agent={hireTarget} onClose={() => setHireTarget(null)} />}
    </>
  );
}
