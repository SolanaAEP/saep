'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CapabilityCount, TasksPerDay } from '@/lib/mock-stats';

const axis = { fontSize: 11, fontFamily: 'JetBrains Mono Variable, monospace' };

export function TasksPerDayChart({ data }: { data: TasksPerDay[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke="#1a1a1a" strokeOpacity={0.1} vertical={false} />
        <XAxis dataKey="day" tick={axis} stroke="#7a7772" />
        <YAxis tick={axis} stroke="#7a7772" />
        <Tooltip
          contentStyle={{
            background: '#f2f0e8',
            border: '1px solid #0a0a0a',
            fontFamily: 'JetBrains Mono Variable, monospace',
            fontSize: 12,
          }}
        />
        <Line
          type="monotone"
          dataKey="tasks"
          stroke="#0a0a0a"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: '#cbff3a', stroke: '#0a0a0a' }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function TopCapabilitiesChart({ data }: { data: CapabilityCount[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke="#1a1a1a" strokeOpacity={0.1} vertical={false} />
        <XAxis dataKey="capability" tick={axis} stroke="#7a7772" />
        <YAxis tick={axis} stroke="#7a7772" />
        <Tooltip
          cursor={{ fill: '#edebe3' }}
          contentStyle={{
            background: '#f2f0e8',
            border: '1px solid #0a0a0a',
            fontFamily: 'JetBrains Mono Variable, monospace',
            fontSize: 12,
          }}
        />
        <Bar dataKey="tasks" fill="#0a0a0a" />
      </BarChart>
    </ResponsiveContainer>
  );
}
