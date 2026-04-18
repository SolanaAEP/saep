'use client';

import type { ReputationDims } from '@saep/sdk';

const AXES = [
  { key: 'quality', label: 'Quality' },
  { key: 'timeliness', label: 'Timeliness' },
  { key: 'availability', label: 'Availability' },
  { key: 'costEfficiency', label: 'Cost Eff.' },
  { key: 'honesty', label: 'Honesty' },
  { key: 'volume', label: 'Volume' },
] as const;

const MAX = 10_000; // bps scale
const SIZE = 200;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 80;
const RINGS = [0.25, 0.5, 0.75, 1];

function polarToXY(angle: number, r: number): [number, number] {
  return [CX + r * Math.cos(angle), CY + r * Math.sin(angle)];
}

function polygon(values: number[]): string {
  return values
    .map((v, i) => {
      const angle = (Math.PI * 2 * i) / values.length - Math.PI / 2;
      const [x, y] = polarToXY(angle, (v / MAX) * R);
      return `${x},${y}`;
    })
    .join(' ');
}

export function ReputationRadar({ reputation }: { reputation: ReputationDims }) {
  const values = AXES.map(({ key }) => reputation[key]);
  const avg = Math.round(values.reduce((s, v) => s + v, 0) / values.length);

  return (
    <div className="border border-ink/10 p-5 flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Reputation</h2>
        <span className="text-[10px] text-ink/50">
          avg {(avg / 100).toFixed(0)}% ({reputation.sampleCount} samples)
        </span>
      </header>

      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full max-w-[240px] mx-auto">
        {/* grid rings */}
        {RINGS.map((scale) => (
          <polygon
            key={scale}
            points={AXES.map((_, i) => {
              const angle = (Math.PI * 2 * i) / AXES.length - Math.PI / 2;
              const [x, y] = polarToXY(angle, R * scale);
              return `${x},${y}`;
            }).join(' ')}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.08}
            strokeWidth={1}
          />
        ))}

        {/* axes */}
        {AXES.map((_, i) => {
          const angle = (Math.PI * 2 * i) / AXES.length - Math.PI / 2;
          const [x, y] = polarToXY(angle, R);
          return (
            <line
              key={i}
              x1={CX}
              y1={CY}
              x2={x}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.08}
              strokeWidth={1}
            />
          );
        })}

        {/* data polygon */}
        <polygon
          points={polygon(values)}
          fill="rgb(163 230 53 / 0.2)"
          stroke="rgb(163 230 53)"
          strokeWidth={1.5}
        />

        {/* axis labels */}
        {AXES.map(({ label }, i) => {
          const angle = (Math.PI * 2 * i) / AXES.length - Math.PI / 2;
          const [x, y] = polarToXY(angle, R + 16);
          return (
            <text
              key={i}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              fill="currentColor"
              fillOpacity={0.5}
              fontSize={8}
            >
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
