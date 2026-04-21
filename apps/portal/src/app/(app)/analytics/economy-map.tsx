import type { AgentGraph as EconomyGraphData } from '@/lib/analytics';
import { capabilityLabel } from '@/lib/analytics';

const W = 520;
const H = 520;
const CX = W / 2;
const CY = H / 2;
const AGENT_RING = 220;
const CAPABILITY_RING = 110;

type Position = {
  x: number;
  y: number;
};

function ring(count: number, radius: number, offset = 0): Position[] {
  return Array.from({ length: count }, (_, index) => {
    const theta = (index / Math.max(count, 1)) * Math.PI * 2 + offset;

    return {
      x: CX + Math.cos(theta) * radius,
      y: CY + Math.sin(theta) * radius,
    };
  });
}

function computeLayout(data: EconomyGraphData) {
  const capabilityBits = Array.from(
    new Set(data.edges.map((edge) => edge.capabilityBit)),
  ).sort((left, right) => left - right);

  const capabilityPositions = new Map<number, Position>();
  ring(capabilityBits.length, CAPABILITY_RING).forEach((position, index) => {
    const bit = capabilityBits[index];
    if (bit !== undefined) capabilityPositions.set(bit, position);
  });

  const agentPositions = new Map<string, Position>();
  ring(data.agents.length, AGENT_RING, -Math.PI / 2).forEach((position, index) => {
    const agent = data.agents[index];
    if (agent) agentPositions.set(agent.agentDidHex, position);
  });

  return { capabilityBits, capabilityPositions, agentPositions };
}

export function AgentEconomyMap({ data }: { data: EconomyGraphData }) {
  const layout = computeLayout(data);

  if (data.agents.length === 0) {
    return (
      <div className="rounded-lg border border-ink/10 p-5 text-sm text-ink/50">
        No indexed agent activity yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-ink/10 p-5 flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Agent Economy Map</h2>
        <span className="text-[10px] text-ink/50">{data.agents.length} agents</span>
      </header>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Agent to capability graph"
      >
        <g>
          {data.edges.map((edge, index) => {
            const agent = layout.agentPositions.get(edge.agentDidHex);
            const capability = layout.capabilityPositions.get(edge.capabilityBit);

            if (!agent || !capability) return null;

            const opacity = Math.min(1, Math.max(0.08, edge.compositeScore / 10000));

            return (
              <line
                key={`${edge.agentDidHex}-${edge.capabilityBit}-${index}`}
                x1={agent.x}
                y1={agent.y}
                x2={capability.x}
                y2={capability.y}
                stroke="#0a0a0a"
                strokeOpacity={opacity}
                strokeWidth={0.6}
              />
            );
          })}
        </g>

        <g>
          {data.agents.map((agent) => {
            const position = layout.agentPositions.get(agent.agentDidHex);
            if (!position) return null;

            const radius = 4 + Math.min(8, Math.log10(agent.jobsCompleted + 1) * 3);

            return (
              <circle
                key={agent.agentDidHex}
                cx={position.x}
                cy={position.y}
                r={radius}
                fill="#cbff3a"
                stroke="#0a0a0a"
                strokeWidth={1}
              />
            );
          })}
        </g>

        <g>
          {layout.capabilityBits.map((bit) => {
            const position = layout.capabilityPositions.get(bit);
            if (!position) return null;

            return (
              <g key={bit}>
                <circle cx={position.x} cy={position.y} r={3} fill="#0a0a0a" />
                <text
                  x={position.x}
                  y={position.y - 8}
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

      <p className="text-[10px] text-ink/40">
        Outer ring: agents sized by completed jobs. Inner ring: capability bits. Line opacity
        tracks composite score.
      </p>
    </div>
  );
}
