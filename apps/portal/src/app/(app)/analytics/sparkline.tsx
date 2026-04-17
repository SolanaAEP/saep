'use client';

interface Props {
  data: { date: string; burned: number }[];
  color: string;
}

export default function Sparkline({ data, color }: Props) {
  if (data.length < 2) return null;

  const max = Math.max(...data.map((d) => d.burned));
  const min = Math.min(...data.map((d) => d.burned));
  const range = max - min || 1;
  const w = 120;
  const h = 32;

  const points = data
    .map((d, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((d.burned - min) / range) * h;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8" preserveAspectRatio="none">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} />
    </svg>
  );
}
