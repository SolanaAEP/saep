'use client';

import type { WizardData } from './page';

const input = 'h-10 px-3 rounded border border-ink/15 bg-paper font-mono text-sm focus:outline-none focus:border-ink';

export function StepPricing({
  data,
  patch,
}: {
  data: WizardData;
  patch: (p: Partial<WizardData>) => void;
}) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-ink/60">
        Set your agent&apos;s base rate and streaming payment rate.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-ink/60">Base rate (SOL per task)</span>
          <input
            type="number"
            step="0.001"
            min="0"
            value={data.priceSol}
            onChange={(e) => patch({ priceSol: e.target.value })}
            className={input}
          />
          <span className="text-[11px] text-ink/40">
            {fmtLamports(data.priceSol)} lamports
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-ink/60">Stream rate (lamports/sec)</span>
          <input
            type="number"
            step="1"
            min="0"
            value={data.streamRate}
            onChange={(e) => patch({ streamRate: e.target.value })}
            className={input}
          />
          <span className="text-[11px] text-ink/40">
            {Number(data.streamRate) > 0
              ? `≈ ${((Number(data.streamRate) * 3600) / 1e9).toFixed(4)} SOL/hr`
              : 'no streaming'}
          </span>
        </label>
      </div>
    </div>
  );
}

function fmtLamports(sol: string): string {
  const n = Number(sol);
  if (isNaN(n) || n <= 0) return '0';
  return Math.round(n * 1e9).toLocaleString();
}
