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
        <h2 className="font-mono text-[11px] uppercase tracking-widest text-ink">Capabilities</h2>
        {selected.size > 0 && (
          <button
            onClick={onClear}
            className="font-mono text-[9px] text-mute hover:text-lime transition-colors uppercase"
          >
            Clear [{selected.size}]
          </button>
        )}
      </header>

      <div className="flex flex-col gap-0.5">
        {bits.map((bit) => {
          const active = selected.has(bit);
          return (
            <button
              key={bit}
              onClick={() => onToggle(bit)}
              className={`font-mono text-[10px] px-2 py-1 text-left transition-colors border-l-2 ${
                active
                  ? 'border-lime text-lime bg-lime/5'
                  : 'border-transparent text-ink/60 hover:border-ink/20 hover:text-ink'
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
