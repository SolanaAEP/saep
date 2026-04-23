'use client';

interface Props {
  query: string;
  minReputation: number;
  sortMode: 'best_fit' | 'reputation' | 'price_asc' | 'recent';
  selectedTaskTitle: string | null;
  activeFilterCount: number;
  onQueryChange: (value: string) => void;
  onMinReputationChange: (value: number) => void;
  onSortModeChange: (value: 'best_fit' | 'reputation' | 'price_asc' | 'recent') => void;
  onClearAll: () => void;
  onClearTask: () => void;
}

const REPUTATION_OPTIONS = [
  { value: 0, label: 'Any track record' },
  { value: 5500, label: '55%+ composite' },
  { value: 7000, label: '70%+ composite' },
  { value: 8500, label: '85%+ composite' },
] as const;

const SORT_OPTIONS = [
  { value: 'best_fit', label: 'Best fit first' },
  { value: 'reputation', label: 'Highest reputation' },
  { value: 'price_asc', label: 'Lowest price' },
  { value: 'recent', label: 'Most recently active' },
] as const;

export function DiscoveryControlsPanel({
  query,
  minReputation,
  sortMode,
  selectedTaskTitle,
  activeFilterCount,
  onQueryChange,
  onMinReputationChange,
  onSortModeChange,
  onClearAll,
  onClearTask,
}: Props) {
  return (
    <section className="border border-ink/10 bg-paper">
      <header className="border-b border-ink/10 px-4 py-4">
        <div className="font-mono text-[10px] uppercase tracking-widest text-mute">Matching</div>
        <div className="mt-1 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-[22px] tracking-[-0.01em]">Recommendation focus</h2>
            <p className="mt-1 text-sm text-ink/60">
              Guide the roster by live task, reputation floor, and ranking preference.
            </p>
          </div>
          {activeFilterCount > 0 ? (
            <button
              type="button"
              onClick={onClearAll}
              className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink/55 transition-colors hover:text-ink"
            >
              Clear all [{activeFilterCount}]
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex flex-col gap-4 px-4 py-4">
        <div className="border border-ink/10 bg-paper-2 px-3 py-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
            Active task context
          </div>
          {selectedTaskTitle ? (
            <div className="mt-2 flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink">
                  {selectedTaskTitle}
                </div>
                <p className="mt-1 text-sm text-ink/60">
                  Ranked matches now prioritize agents that fit this live bounty.
                </p>
              </div>
              <button
                type="button"
                onClick={onClearTask}
                className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink/55 transition-colors hover:text-ink"
              >
                Clear
              </button>
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink/60">
              Pick a live bounty below to turn the roster into a task-specific recommendation list.
            </p>
          )}
        </div>

        <label className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-mute">
            Search agents
          </span>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search by name, host, DID, or capability"
            className="h-11 border border-ink/10 bg-paper px-3 text-sm text-ink outline-none transition-colors placeholder:text-ink/35 focus:border-ink/30"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-mute">
            Minimum reputation
          </span>
          <select
            value={minReputation}
            onChange={(event) => onMinReputationChange(Number(event.target.value))}
            className="h-11 border border-ink/10 bg-paper px-3 text-sm text-ink outline-none transition-colors focus:border-ink/30"
          >
            {REPUTATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-mute">
            Sort roster
          </span>
          <select
            value={sortMode}
            onChange={(event) =>
              onSortModeChange(event.target.value as 'best_fit' | 'reputation' | 'price_asc' | 'recent')
            }
            className="h-11 border border-ink/10 bg-paper px-3 text-sm text-ink outline-none transition-colors focus:border-ink/30"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
