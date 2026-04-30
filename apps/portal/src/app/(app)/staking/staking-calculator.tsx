'use client';

import { useState, useMemo } from 'react';

const DAY = 86400;
const MIN_LOCKUP_SECS = 7 * DAY;
const MAX_LOCKUP_SECS = 365 * DAY;
const MAX_MULTIPLIER = 4;
const LOCK_PRESETS = [7, 30, 90, 180, 365] as const;

interface Props {
  price: number | null;
  decimals: number;
  totalStaked: bigint | null;
}

function computeMultiplier(lockDays: number): number {
  const lockupSecs = lockDays * DAY;
  if (lockupSecs <= MIN_LOCKUP_SECS) return 1;
  const range = MAX_LOCKUP_SECS - MIN_LOCKUP_SECS;
  const elapsed = Math.min(lockupSecs - MIN_LOCKUP_SECS, range);
  return 1 + Math.floor((elapsed * (MAX_MULTIPLIER - 1)) / range);
}

export function StakingCalculator({ price, decimals, totalStaked }: Props) {
  const [amount, setAmount] = useState('10000');
  const [lockDays, setLockDays] = useState(90);

  const result = useMemo(() => {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return null;

    const multiplier = computeMultiplier(lockDays);
    const votingPower = parsed * multiplier;
    const usdValue = price ? parsed * price : null;
    const votingPowerUsd = price ? votingPower * price : null;

    const totalStakedNum = totalStaked
      ? Number(totalStaked) / 10 ** decimals
      : null;

    const poolShare = totalStakedNum && totalStakedNum > 0
      ? (votingPower / (totalStakedNum * 2 + votingPower)) * 100
      : null;

    return { multiplier, votingPower, usdValue, votingPowerUsd, poolShare };
  }, [amount, lockDays, price, totalStaked, decimals]);

  return (
    <div className="border border-ink/10 bg-paper">
      <div className="border-b border-ink/10 px-5 py-4">
        <div className="font-mono text-[10px] uppercase tracking-widest text-mute">Staking</div>
        <h2 className="mt-1 font-display text-[22px] tracking-[-0.01em]">Yield calculator</h2>
        <p className="mt-1 text-sm text-ink/55">Estimate voting power and pool share.</p>
      </div>
      <div className="px-5 py-5 flex flex-col gap-5">
        <div>
          <label className="font-mono text-[10px] uppercase tracking-widest text-mute" htmlFor="calc-amount">
            SAEP amount
          </label>
          <input
            id="calc-amount"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-2 h-10 w-full border border-ink/15 bg-paper-2 px-3 font-mono text-sm text-ink placeholder:text-mute focus:border-ink/35 focus:outline-none"
            placeholder="10000"
          />
          {result?.usdValue != null && (
            <div className="mt-1 font-mono text-[10px] text-mute">
              ≈ ${result.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-widest text-mute">Lock period</span>
            <span className="font-mono text-[10px] text-ink">{lockDays}d</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {LOCK_PRESETS.map((d) => (
              <button
                key={d}
                onClick={() => setLockDays(d)}
                className={`h-8 px-3 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors border ${
                  lockDays === d
                    ? 'border-ink bg-ink text-paper'
                    : 'border-ink/15 text-ink/60 hover:border-ink/30'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <input
            type="range"
            min={7}
            max={365}
            step={1}
            value={lockDays}
            onChange={(e) => setLockDays(Number(e.target.value))}
            className="mt-3 w-full accent-lime"
          />
        </div>

        {result && (
          <div className="border border-ink/10 divide-y divide-ink/10">
            <CalcRow label="Multiplier" value={`${result.multiplier}x`} />
            <CalcRow
              label="Voting power"
              value={`${result.votingPower.toLocaleString(undefined, { maximumFractionDigits: 0 })} SAEP`}
            />
            {result.poolShare != null && (
              <CalcRow
                label="Est. pool share"
                value={`${result.poolShare < 0.01 ? '< 0.01' : result.poolShare.toFixed(2)}%`}
              />
            )}
            {result.votingPowerUsd != null && (
              <CalcRow
                label="Weighted value"
                value={`$${result.votingPowerUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CalcRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="font-mono text-[10px] uppercase tracking-widest text-mute">{label}</span>
      <span className="font-mono text-sm text-ink">{value}</span>
    </div>
  );
}
