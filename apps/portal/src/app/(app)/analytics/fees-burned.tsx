'use client';

import { useEffect, useRef, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';

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

function Sparkline({ data, color }: { data: { date: string; burned: number }[]; color: string }) {
  return (
    <ResponsiveContainer width="100%" height={48}>
      <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`burn-grad-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Tooltip
          contentStyle={{ background: 'var(--paper-2)', border: '1px solid var(--mute-2)', fontSize: 11 }}
          labelStyle={{ color: 'var(--mute)', fontSize: 10 }}
          formatter={(v) => [`${Number(v).toLocaleString()} SAEP`, 'Burned']}
        />
        <Area
          type="monotone"
          dataKey="burned"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#burn-grad-${color})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
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
          <Sparkline data={last7} color="var(--lime)" />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-[10px] text-ink/50">
            <span>30d burn rate</span>
            <span className="font-mono">{burn30d.toLocaleString()}</span>
          </div>
          <Sparkline data={last30} color="var(--lime-2)" />
        </div>
      </div>
    </div>
  );
}
