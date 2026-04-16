import type { AgentGraph } from '@/lib/indexer';
import { capabilityLabel } from '@/lib/indexer';

const W = 520;
const H = 520;
const CX = W / 2;
const CY = H / 2;
const R_AGENT = 220;
const R_CAP = 110;

type Pos = { x: number; y: number };

function ring(n: number, r: number, offset = 0): Pos[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / Math.max(n, 1)) * Math.PI * 2 + offset;
    return { x: CX + Math.cos(t) * r, y: CY + Math.sin(t) * r };
  });
}

function computeLayout(data: AgentGraph) {
  const caps = Array.from(new Set(data.edges.map((e) => e.capabilityBit))).sort(
    (a, b) => a - b,
  );
  const capPos = new Map<number, Pos>();
  ring(caps.length, R_CAP).forEach((p, i) => {
    const bit = caps[i];
    if (bit !== undefined) capPos.set(bit, p);
  });
  const agentPos = new Map<string, Pos>();
  ring(data.agents.length, R_AGENT, -Math.PI / 2).forEach((p, i) => {
    const a = data.agents[i];
    if (a) agentPos.set(a.agentDidHex, p);
  });
  return { caps, capPos, agentPos };
}

export function AgentEconomyMap({ data }: { data: AgentGraph }) {
  const layout = computeLayout(data);

  if (data.agents.length === 0) {
    return (
      <div className="border border-ink p-5 text-sm text-mute">
        No agent activity to map yet.
      </div>
    );
  }

  return (
    <div className="border border-ink p-5">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
        Agent ↔ capability graph · top {data.agents.length}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-3 w-full"
        role="img"
        aria-label="Agent economy graph"
      >
        <g>
          {data.edges.map((e, i) => {
            const a = layout.agentPos.get(e.agentDidHex);
            const c = layout.capPos.get(e.capabilityBit);
            if (!a || !c) return null;
            const opacity = Math.min(1, Math.max(0.08, e.compositeScore / 10000));
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={c.x}
                y2={c.y}
                stroke="#0a0a0a"
                strokeOpacity={opacity}
                strokeWidth={0.6}
              />
            );
          })}
        </g>
        <g>
          {data.agents.map((a) => {
            const p = layout.agentPos.get(a.agentDidHex)!;
            const r = 4 + Math.min(8, Math.log10(a.jobsCompleted + 1) * 3);
            return (
              <g key={a.agentDidHex}>
                <circle cx={p.x} cy={p.y} r={r} fill="#cbff3a" stroke="#0a0a0a" strokeWidth={1} />
              </g>
            );
          })}
        </g>
        <g>
          {layout.caps.map((bit) => {
            const p = layout.capPos.get(bit)!;
            return (
              <g key={bit}>
                <circle cx={p.x} cy={p.y} r={3} fill="#0a0a0a" />
                <text
                  x={p.x}
                  y={p.y - 8}
                  textAnchor="middle"
                  fontSize={9}
                  fontFamily="JetBrains Mono Variable, monospace"
                  fill="#7a7772"
                >
                  {capabilityLabel(bit)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.08em] text-mute-2">
        Outer ring: agents (size = jobs). Inner ring: capability bits. Line opacity = score.
      </div>
    </div>
  );
}
