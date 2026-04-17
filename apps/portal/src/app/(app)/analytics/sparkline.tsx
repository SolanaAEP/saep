'use client';

import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';

interface Props {
  data: { date: string; burned: number }[];
  color: string;
}

export default function Sparkline({ data, color }: Props) {
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
