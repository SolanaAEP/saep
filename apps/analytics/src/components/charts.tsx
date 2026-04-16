import type { CapabilityCount, TasksPerDay } from '@/lib/indexer';

const W = 520;
const H = 260;
const PAD_L = 32;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 28;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

const AXIS = 'JetBrains Mono Variable, monospace';

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

function yTicks(max: number): number[] {
  return [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * max));
}

export function TasksPerDayChart({ data }: { data: TasksPerDay[] }) {
  if (data.length === 0) {
    return <EmptyChart label="No data" />;
  }
  const max = niceMax(Math.max(...data.map((d) => d.tasks), 1));
  const xStep = data.length > 1 ? PLOT_W / (data.length - 1) : 0;
  const pts = data.map((d, i) => {
    const x = PAD_L + i * xStep;
    const y = PAD_T + PLOT_H - (d.tasks / max) * PLOT_H;
    return { x, y, d };
  });
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const ticks = yTicks(max);
  const xLabelEvery = Math.max(1, Math.ceil(data.length / 6));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Tasks per day">
      {ticks.map((t) => {
        const y = PAD_T + PLOT_H - (t / max) * PLOT_H;
        return (
          <g key={t}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#1a1a1a" strokeOpacity={0.1} />
            <text x={PAD_L - 6} y={y + 3} textAnchor="end" fontSize={11} fontFamily={AXIS} fill="#7a7772">
              {t}
            </text>
          </g>
        );
      })}
      {pts.map(
        (p, i) =>
          i % xLabelEvery === 0 && (
            <text
              key={p.d.day}
              x={p.x}
              y={H - 8}
              textAnchor="middle"
              fontSize={11}
              fontFamily={AXIS}
              fill="#7a7772"
            >
              {p.d.day.slice(5)}
            </text>
          ),
      )}
      <path d={path} fill="none" stroke="#0a0a0a" strokeWidth={2} />
    </svg>
  );
}

export function TopCapabilitiesChart({ data }: { data: CapabilityCount[] }) {
  if (data.length === 0) {
    return <EmptyChart label="No data" />;
  }
  const max = niceMax(Math.max(...data.map((d) => d.tasks), 1));
  const ticks = yTicks(max);
  const slot = PLOT_W / data.length;
  const barW = slot * 0.7;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Top capabilities">
      {ticks.map((t) => {
        const y = PAD_T + PLOT_H - (t / max) * PLOT_H;
        return (
          <g key={t}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#1a1a1a" strokeOpacity={0.1} />
            <text x={PAD_L - 6} y={y + 3} textAnchor="end" fontSize={11} fontFamily={AXIS} fill="#7a7772">
              {t}
            </text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const h = (d.tasks / max) * PLOT_H;
        const x = PAD_L + i * slot + (slot - barW) / 2;
        const y = PAD_T + PLOT_H - h;
        return (
          <g key={d.capability}>
            <rect x={x} y={y} width={barW} height={h} fill="#0a0a0a" />
            <text
              x={x + barW / 2}
              y={H - 8}
              textAnchor="middle"
              fontSize={10}
              fontFamily={AXIS}
              fill="#7a7772"
            >
              {d.capability}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div
      className="flex items-center justify-center border border-ink text-sm text-mute"
      style={{ height: H }}
    >
      {label}
    </div>
  );
}
