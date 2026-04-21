import { CAPABILITY_LABELS } from '@/app/(app)/dashboard/capability-tags';

export type Totals = {
  agents: number;
  tasks: number;
  volumeSol: number;
  activeStreams: number;
};

export type TasksPerDay = {
  day: string;
  tasks: number;
};

export type CapabilityCount = {
  capabilityBit: number;
  capability: string;
  tasks: number;
};

export type FeesBurned = {
  protocolFeesLamports: number;
  solrepFeesLamports: number;
  last24hLamports: number;
};

export type NetworkHealth = {
  latestSlot: number;
  reorgs24h: number;
  eventsPerMin: number;
  eventsTotal: number;
  blocksTotal: number;
};

export type TopAgent = {
  agentDidHex: string;
  avgScore: number;
  jobsCompleted: number;
  categories: number;
};

export type AgentGraph = {
  agents: { agentDidHex: string; jobsCompleted: number; avgScore: number }[];
  edges: { agentDidHex: string; capabilityBit: number; compositeScore: number }[];
};

export type AnalyticsSnapshot = {
  totals: Totals;
  tasksPerDay: TasksPerDay[];
  topCapabilities: CapabilityCount[];
  feesBurned: FeesBurned;
  health: NetworkHealth;
  topAgents: TopAgent[];
  graph: AgentGraph;
  source: 'live' | 'mock';
  fetchedAt: string;
};

type RawTotals = {
  agents: number;
  tasks: number;
  volume_lamports: number;
  active_streams: number;
};

type RawDay = {
  day: string;
  tasks: number;
};

type RawCapability = {
  capability_bit: number;
  tasks: number;
};

type RawFees = {
  protocol_fees_lamports: number;
  solrep_fees_lamports: number;
  last_24h_lamports: number;
};

type RawHealth = {
  latest_slot: number;
  reorgs_24h: number;
  events_per_min: number;
  events_total: number;
  blocks_total: number;
};

type RawTopAgent = {
  agent_did_hex: string;
  avg_score: number;
  jobs_completed: number;
  categories: number;
};

type RawGraph = {
  agents: { agent_did_hex: string; jobs_completed: number; avg_score: number }[];
  edges: { agent_did_hex: string; capability_bit: number; composite_score: number }[];
};

const BASE = process.env.INDEXER_URL ?? process.env.NEXT_PUBLIC_INDEXER_URL ?? '';
const TIMEOUT_MS = 4_000;
const LAMPORTS_PER_SOL = 1_000_000_000;

async function get<T>(path: string): Promise<T> {
  if (!BASE) throw new Error('INDEXER_URL not set');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE}${path}`, {
      signal: controller.signal,
      next: { revalidate: 30 },
    });

    if (!response.ok) {
      throw new Error(`indexer ${path} ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

const mockTotals: Totals = {
  agents: 1_284,
  tasks: 27_310,
  volumeSol: 48_920,
  activeStreams: 96,
};

const mockTasksPerDay: TasksPerDay[] = Array.from({ length: 90 }, (_, i) => {
  const date = new Date();
  date.setDate(date.getDate() - (89 - i));
  const base = 180 + Math.sin(i / 4) * 70 + i * 3;

  return {
    day: date.toISOString().slice(5, 10),
    tasks: Math.max(0, Math.round(base + (i % 6) * 14)),
  };
});

const mockTopCapabilities: CapabilityCount[] = [
  { capabilityBit: 2, capability: capabilityLabel(2), tasks: 8_420 },
  { capabilityBit: 5, capability: capabilityLabel(5), tasks: 5_130 },
  { capabilityBit: 14, capability: capabilityLabel(14), tasks: 4_210 },
  { capabilityBit: 8, capability: capabilityLabel(8), tasks: 3_680 },
  { capabilityBit: 20, capability: capabilityLabel(20), tasks: 2_940 },
  { capabilityBit: 0, capability: capabilityLabel(0), tasks: 1_870 },
];

const mockFees: FeesBurned = {
  protocolFeesLamports: 412_300_000_000,
  solrepFeesLamports: 187_900_000_000,
  last24hLamports: 9_840_000_000,
};

const mockHealth: NetworkHealth = {
  latestSlot: 287_412_009,
  reorgs24h: 2,
  eventsPerMin: 184,
  eventsTotal: 312_408,
  blocksTotal: 287_412,
};

const mockTopAgents: TopAgent[] = Array.from({ length: 12 }, (_, i) => ({
  agentDidHex: ('0'.repeat(60) + (i + 1).toString(16).padStart(4, '0')).slice(-64),
  avgScore: 9_200 - i * 170,
  jobsCompleted: 980 - i * 55,
  categories: Math.max(1, 6 - Math.floor(i / 2)),
}));

const mockGraph: AgentGraph = {
  agents: mockTopAgents.map((agent) => ({
    agentDidHex: agent.agentDidHex,
    jobsCompleted: agent.jobsCompleted,
    avgScore: agent.avgScore,
  })),
  edges: mockTopAgents.flatMap((agent, index) =>
    Array.from({ length: agent.categories }, (_, offset) => ({
      agentDidHex: agent.agentDidHex,
      capabilityBit: (index + offset) % 32,
      compositeScore: agent.avgScore - offset * 40,
    })),
  ),
};

function mockSnapshot(fetchedAt: string): AnalyticsSnapshot {
  return {
    totals: mockTotals,
    tasksPerDay: mockTasksPerDay,
    topCapabilities: mockTopCapabilities,
    feesBurned: mockFees,
    health: mockHealth,
    topAgents: mockTopAgents,
    graph: mockGraph,
    source: 'mock',
    fetchedAt,
  };
}

export async function loadAnalyticsSnapshot(): Promise<AnalyticsSnapshot> {
  const fetchedAt = new Date().toISOString();

  if (!BASE) {
    return mockSnapshot(fetchedAt);
  }

  try {
    const [totals, tasksPerDay, topCapabilities, feesBurned, health, topAgents, graph] =
      await Promise.all([
        get<RawTotals>('/stats/totals'),
        get<RawDay[]>('/stats/tasks-per-day?days=90'),
        get<RawCapability[]>('/stats/top-capabilities?limit=8'),
        get<RawFees>('/stats/fees-burned'),
        get<RawHealth>('/stats/network-health'),
        get<RawTopAgent[]>('/stats/top-agents?limit=20'),
        get<RawGraph>('/stats/agent-graph?limit=24'),
      ]);

    return {
      totals: {
        agents: totals.agents,
        tasks: totals.tasks,
        volumeSol: totals.volume_lamports / LAMPORTS_PER_SOL,
        activeStreams: totals.active_streams,
      },
      tasksPerDay: tasksPerDay.map((entry) => ({
        day: entry.day,
        tasks: entry.tasks,
      })),
      topCapabilities: topCapabilities.map((entry) => ({
        capabilityBit: entry.capability_bit,
        capability: capabilityLabel(entry.capability_bit),
        tasks: entry.tasks,
      })),
      feesBurned: {
        protocolFeesLamports: feesBurned.protocol_fees_lamports,
        solrepFeesLamports: feesBurned.solrep_fees_lamports,
        last24hLamports: feesBurned.last_24h_lamports,
      },
      health: {
        latestSlot: health.latest_slot,
        reorgs24h: health.reorgs_24h,
        eventsPerMin: health.events_per_min,
        eventsTotal: health.events_total,
        blocksTotal: health.blocks_total,
      },
      topAgents: topAgents.map((agent) => ({
        agentDidHex: agent.agent_did_hex,
        avgScore: agent.avg_score,
        jobsCompleted: agent.jobs_completed,
        categories: agent.categories,
      })),
      graph: {
        agents: graph.agents.map((agent) => ({
          agentDidHex: agent.agent_did_hex,
          jobsCompleted: agent.jobs_completed,
          avgScore: agent.avg_score,
        })),
        edges: graph.edges.map((edge) => ({
          agentDidHex: edge.agent_did_hex,
          capabilityBit: edge.capability_bit,
          compositeScore: edge.composite_score,
        })),
      },
      source: 'live',
      fetchedAt,
    };
  } catch (error) {
    console.warn('[portal analytics] indexer fetch failed, falling back to mock:', error);
    return mockSnapshot(fetchedAt);
  }
}

export function capabilityLabel(bit: number): string {
  return CAPABILITY_LABELS[bit] ?? `bit-${bit}`;
}
