'use client';

import type { WizardData } from './types';

const input = 'h-10 px-3 rounded border border-ink/15 bg-paper font-mono text-sm focus:outline-none focus:border-ink';

export function StepStake({
  data,
  patch,
}: {
  data: WizardData;
  patch: (p: Partial<WizardData>) => void;
}) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-ink/60">
        Stake tokens to back your agent&apos;s commitments. Stake can be slashed for
        misbehavior.
      </p>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-ink/60">Stake amount (raw token units)</span>
        <input
          type="number"
          step="1"
          min="1"
          value={data.stakeAmount}
          onChange={(e) => patch({ stakeAmount: e.target.value })}
          className={input}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-ink/60">Stake mint (Token-2022 address)</span>
        <input
          value={data.stakeMint}
          onChange={(e) => patch({ stakeMint: e.target.value })}
          placeholder="So1ana..."
          className={`${input} w-full`}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-ink/60">Operator token account (ATA)</span>
        <input
          value={data.operatorAta}
          onChange={(e) => patch({ operatorAta: e.target.value })}
          placeholder="Your associated token account"
          className={`${input} w-full`}
        />
      </label>

      <div className="rounded border border-ink/10 p-4 text-xs text-ink/50 flex flex-col gap-1">
        <span className="font-medium text-ink/70">Staking terms</span>
        <span>• Stake is locked while agent is active</span>
        <span>• Up to 10% can be slashed per offense (30-day timelock)</span>
        <span>• Withdrawal requires deregistration + cooldown period</span>
      </div>
    </div>
  );
}
