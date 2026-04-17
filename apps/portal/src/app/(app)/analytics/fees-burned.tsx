'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

const LazySparkline = dynamic(() => import('./sparkline'), { ssr: false });

export interface BurnStats {
  cumulativeBurned: number;
  daily: { date: string; burned: number }[];
}

function useAnimatedCount(target: number, durationMs = 1200) {
  const [value, setValue] = useState(0);
  const raf = useRef<number>(0);

  useEffect(() => {
    const start = performance.now();
    const from = 0;

    function tick(now: number) {
      const t = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    }

    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, durationMs]);

  return value;
}


export function FeesBurnedCounter({ stats }: { stats: BurnStats }) {
  const animated = useAnimatedCount(stats.cumulativeBurned);
  const last7 = stats.daily.slice(-7);
  const last30 = stats.daily.slice(-30);

  const burn7d = last7.reduce((s, d) => s + d.burned, 0);
  const burn30d = last30.reduce((s, d) => s + d.burned, 0);

  return (
    <div className="rounded-lg border border-ink/10 p-5 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Fees Burned</h2>
        <span className="text-[10px] text-ink/50 font-mono">SAEP token</span>
      </header>

      <div className="text-3xl font-mono font-semibold tracking-tight">
        {animated.toLocaleString()}
        <span className="text-sm text-ink/50 ml-1.5">SAEP</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-[10px] text-ink/50">
            <span>7d burn rate</span>
            <span className="font-mono">{burn7d.toLocaleString()}</span>
          </div>
          <LazySparkline data={last7} color="var(--lime)" />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-[10px] text-ink/50">
            <span>30d burn rate</span>
            <span className="font-mono">{burn30d.toLocaleString()}</span>
          </div>
          <LazySparkline data={last30} color="var(--lime-2)" />
        </div>
      </div>
    </div>
  );
}
