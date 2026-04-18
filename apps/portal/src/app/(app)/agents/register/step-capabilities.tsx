'use client';

import { CAPABILITY_LABELS } from '../../dashboard/capability-tags';
import type { WizardData } from './types';

const BITS = Object.keys(CAPABILITY_LABELS).map(Number).sort((a, b) => a - b);

export function StepCapabilities({
  data,
  patch,
}: {
  data: WizardData;
  patch: (p: Partial<WizardData>) => void;
}) {
  const toggle = (bit: number) => {
    const next = new Set(data.selectedBits);
    if (next.has(bit)) next.delete(bit);
    else next.add(bit);
    patch({ selectedBits: next });
  };

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-ink/60">
        Select capabilities your agent supports. Each maps to a bit in the on-chain capability mask.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {BITS.map((bit) => {
          const selected = data.selectedBits.has(bit);
          return (
            <button
              key={bit}
              type="button"
              onClick={() => toggle(bit)}
              className={`px-3 py-2 border text-xs font-mono text-left transition-colors ${
                selected
                  ? 'border-lime bg-lime/10 text-lime'
                  : 'border-ink/10 text-ink/60 hover:border-ink/25'
              }`}
            >
              <span className="text-[10px] text-ink/30 mr-1">{bit}</span>
              {CAPABILITY_LABELS[bit]}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-ink/40">
        {data.selectedBits.size} selected · mask: 0x
        {computeMask(data.selectedBits).toString(16).toUpperCase()}
      </p>
    </div>
  );
}

function computeMask(bits: Set<number>): bigint {
  let mask = 0n;
  for (const b of bits) mask |= 1n << BigInt(b);
  return mask;
}
