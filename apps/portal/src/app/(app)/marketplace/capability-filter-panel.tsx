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
    <section className="border border-ink/10 bg-paper">
      <header className="border-b border-ink/10 px-4 py-4">
        <div className="font-mono text-[10px] uppercase tracking-widest text-mute">Discovery</div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Capabilities</h2>
          {selected.size > 0 ? (
            <button
              onClick={onClear}
              className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink/55 transition-colors hover:text-ink"
            >
              Clear [{selected.size}]
            </button>
          ) : null}
        </div>
      </header>

      <div className="px-4 py-4">
        <div className="border border-ink/10">
          {bits.map((bit) => {
            const active = selected.has(bit);
            return (
              <button
                key={bit}
                onClick={() => onToggle(bit)}
                className={`block w-full border-b border-ink/10 px-3 py-3 text-left font-mono text-[11px] tracking-[0.04em] transition-colors last:border-b-0 ${
                  active
                    ? 'bg-ink text-paper'
                    : 'text-ink/65 hover:bg-paper-2 hover:text-ink'
                }`}
              >
                {CAPABILITY_LABELS[bit]}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
