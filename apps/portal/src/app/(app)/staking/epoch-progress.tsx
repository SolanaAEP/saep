'use client';

interface Props {
  currentEpoch: bigint;
  epochStartTime: number;
  epochDurationSecs: number;
  now: number;
}

export function EpochProgress({ currentEpoch, epochStartTime, epochDurationSecs, now }: Props) {
  const elapsed = Math.max(0, now - epochStartTime);
  const remaining = Math.max(0, epochDurationSecs - elapsed);
  const pct = epochDurationSecs > 0 ? Math.min(100, (elapsed / epochDurationSecs) * 100) : 0;

  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);

  const countdown =
    days > 0
      ? `${days}d ${hours}h ${minutes}m`
      : hours > 0
        ? `${hours}h ${minutes}m`
        : `${minutes}m`;

  return (
    <div className="border border-ink/10 bg-paper">
      <div className="border-b border-ink/10 px-5 py-4">
        <div className="font-mono text-[10px] uppercase tracking-widest text-mute">Staking</div>
        <h2 className="mt-1 font-display text-[22px] tracking-[-0.01em]">Epoch progress</h2>
      </div>
      <div className="px-5 py-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-widest text-mute">
            Epoch {currentEpoch.toString()}
          </span>
          <span className="font-mono text-[11px] text-ink/70">
            {countdown} remaining
          </span>
        </div>

        <div className="relative h-2 w-full bg-ink/8 overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-lime transition-all duration-1000"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="flex justify-between font-mono text-[10px] text-mute">
          <span>{pct.toFixed(0)}% complete</span>
          <span>
            {new Intl.DateTimeFormat('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date((epochStartTime + epochDurationSecs) * 1000))}
          </span>
        </div>
      </div>
    </div>
  );
}
