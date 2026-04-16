'use client';

import { CAPABILITY_LABELS } from '../dashboard/capability-tags';

interface Props {
  selected: Set<number>;
  onToggle: (bit: number) => void;
  onClear: () => void;
}

export function CapabilityFilterPanel({ selected, onToggle, onClear }: Props) {
  const bits = Object.keys(CAPABILITY_LABELS).map(Number);

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Capabilities</h2>
        {selected.size > 0 && (
          <button
            onClick={onClear}
            className="text-[10px] text-ink/50 hover:text-ink underline"
          >
            Clear all
          </button>
        )}
      </header>
      <div className="grid grid-cols-2 gap-1.5">
        {bits.map((bit) => {
          const active = selected.has(bit);
          return (
            <button
              key={bit}
              onClick={() => onToggle(bit)}
              className={`text-[11px] px-2 py-1 rounded text-left transition-colors ${
                active
                  ? 'bg-lime/20 text-lime border border-lime/40'
                  : 'bg-ink/5 text-ink/70 border border-transparent hover:border-ink/20'
              }`}
            >
              {CAPABILITY_LABELS[bit]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
