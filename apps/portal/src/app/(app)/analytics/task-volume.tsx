'use client';

import { useState, useMemo } from 'react';
import type { CapabilityCount, TasksPerDay } from '@/lib/analytics';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface TaskVolumeData {
  tasksPerDay: TasksPerDay[];
  topCapabilities: CapabilityCount[];
}

type Range = '7d' | '30d' | '90d';

const RANGE_DAYS: Record<Range, number> = { '7d': 7, '30d': 30, '90d': 90 };

export function TaskVolumeChart({ data }: { data: TaskVolumeData }) {
  const [range, setRange] = useState<Range>('30d');

  const sliced = useMemo(
    () => data.tasksPerDay.slice(-Math.min(RANGE_DAYS[range], data.tasksPerDay.length)),
    [data.tasksPerDay, range],
  );
  const totalTasks = useMemo(
    () => sliced.reduce((sum, entry) => sum + entry.tasks, 0),
    [sliced],
  );
  const peakDay = useMemo(
    () => sliced.reduce<TasksPerDay | null>(
      (peak, entry) => (!peak || entry.tasks > peak.tasks ? entry : peak),
      null,
    ),
    [sliced],
  );
  const averageTasks = sliced.length > 0 ? Math.round(totalTasks / sliced.length) : 0;
  const maxCapabilityTasks = Math.max(...data.topCapabilities.map((entry) => entry.tasks), 1);

  return (
    <div className="rounded-lg border border-ink/10 p-5 flex flex-col gap-4">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-medium">Tasks Settled</h2>
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

      <div className="grid gap-3 sm:grid-cols-3">
        <RangeStat label="Tasks in range" value={totalTasks.toLocaleString()} />
        <RangeStat label="Average / day" value={averageTasks.toLocaleString()} />
        <RangeStat
          label="Peak day"
          value={peakDay ? `${peakDay.tasks.toLocaleString()} (${peakDay.day})` : '—'}
        />
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={sliced} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="volume-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--lime)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--lime)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--mute-2)" strokeOpacity={0.3} />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 10, fill: 'var(--mute)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--mute)' }}
            tickFormatter={formatCompactNumber}
            axisLine={false}
            tickLine={false}
            width={50}
          />
          <Tooltip
            contentStyle={{ background: 'var(--paper-2)', border: '1px solid var(--mute-2)', fontSize: 11 }}
            labelStyle={{ color: 'var(--mute)', fontSize: 10 }}
            formatter={(value) => [Number(value).toLocaleString(), 'Tasks']}
          />
          <Area
            type="monotone"
            dataKey="tasks"
            stroke="var(--lime)"
            strokeWidth={2}
            fill="url(#volume-grad)"
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="flex flex-col gap-2">
        <div className="text-[10px] font-mono uppercase tracking-[0.08em] text-ink/50">
          Top capabilities by completed task count
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {data.topCapabilities.map((entry) => (
            <div key={entry.capabilityBit} className="rounded-md bg-ink/5 px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{entry.capability}</span>
                <span className="font-mono text-ink/60">{entry.tasks.toLocaleString()}</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-ink/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-lime"
                  style={{ width: `${Math.max(8, (entry.tasks / maxCapabilityTasks) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RangeStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-ink/5 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.08em] text-ink/50">{label}</div>
      <div className="mt-1 font-mono text-sm">{value}</div>
    </div>
  );
}

function formatCompactNumber(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toString();
}
