'use client';

import { useState, useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface TaskVolumeEntry {
  date: string;
  taskCount: number;
  taskValueUsdc: number;
  protocolFeeUsdc: number;
  categories: Record<string, number>;
}

export type TaskVolumeData = TaskVolumeEntry[];

type Range = '7d' | '30d' | '90d';

const RANGE_DAYS: Record<Range, number> = { '7d': 7, '30d': 30, '90d': 90 };

const SERIES = [
  { key: 'taskCount', label: 'Tasks', color: 'var(--lime)', unit: '' },
  { key: 'taskValueUsdc', label: 'Value (USDC)', color: '#5eead4', unit: '$' },
  { key: 'protocolFeeUsdc', label: 'Protocol fees', color: '#fbbf24', unit: '$' },
] as const;

export function TaskVolumeChart({ data }: { data: TaskVolumeData }) {
  const [range, setRange] = useState<Range>('30d');
  const [activeSeries, setActiveSeries] = useState<(typeof SERIES)[number]['key']>('taskCount');

  const sliced = useMemo(() => data.slice(-RANGE_DAYS[range]), [data, range]);

  const series = SERIES.find((s) => s.key === activeSeries)!;

  return (
    <div className="rounded-lg border border-ink/10 p-5 flex flex-col gap-4">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-medium">Task Volume</h2>
        <div className="flex gap-1">
          {(['7d', '30d', '90d'] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`text-[10px] px-2 py-1 rounded font-mono transition-colors ${
                range === r ? 'bg-lime/15 text-lime' : 'text-ink/50 hover:text-ink/80'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </header>

      <div className="flex gap-2">
        {SERIES.map((s) => (
          <button
            key={s.key}
            onClick={() => setActiveSeries(s.key)}
            className={`text-[10px] px-2 py-1 rounded transition-colors ${
              activeSeries === s.key
                ? 'bg-ink/10 text-ink font-medium'
                : 'text-ink/50 hover:text-ink/80'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={sliced} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="volume-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={series.color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={series.color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--mute-2)" strokeOpacity={0.3} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: 'var(--mute)' }}
            tickFormatter={(v: string) => v.slice(5)}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--mute)' }}
            tickFormatter={(v: number) => series.unit + (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toString())}
            axisLine={false}
            tickLine={false}
            width={50}
          />
          <Tooltip
            contentStyle={{ background: 'var(--paper-2)', border: '1px solid var(--mute-2)', fontSize: 11 }}
            labelStyle={{ color: 'var(--mute)', fontSize: 10 }}
            formatter={(v) => [series.unit + Number(v).toLocaleString(), series.label]}
          />
          <Area
            type="monotone"
            dataKey={series.key}
            stroke={series.color}
            strokeWidth={2}
            fill="url(#volume-grad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
