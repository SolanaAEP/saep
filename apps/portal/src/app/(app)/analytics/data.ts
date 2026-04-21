import type { BurnStats } from './fees-burned';
import type { EconomyGraphData } from './economy-map';
import type { LeaderboardAgent } from './leaderboard';
import type { NetworkHealth } from './network-health';
import type { TaskVolumeData } from './task-volume';

const INDEXER_URL = process.env.INDEXER_URL ?? process.env.NEXT_PUBLIC_INDEXER_URL ?? '';
const TIMEOUT_MS = 4_000;

type RawTotals = {
  agents: number;
  tasks: number;
  volume_lamports: number;
  active_streams: number;
};

type RawTaskDay = {
  day: string;
  tasks: number;
};

type RawFees = {
  protocol_fees_lamports: number;
  solrep_fees_lamports: number;
  last_24h_lamports: number;
};

type RawNetworkHealth = {
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

export type AnalyticsSnapshot = {
  burnStats: BurnStats;
  economyGraph: EconomyGraphData;
  taskVolume: TaskVolumeData;
  leaderboard: LeaderboardAgent[];
  networkHealth: NetworkHealth;
  source: 'live' | 'mock';
  fetchedAt: string;
};

async function get<T>(path: string): Promise<T> {
  if (!INDEXER_URL) throw new Error('INDEXER_URL not set');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const init: RequestInit & { next: { revalidate: number } } = {
    signal: controller.signal,
    next: { revalidate: 30 },
  };

  try {
    const res = await fetch(`${INDEXER_URL}${path}`, init);

    if (!res.ok) {
      throw new Error(`indexer ${path} ${res.status}`);
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const CAPABILITY_LABELS: Record<number, string> = {
  0: 'RAG',
  1: 'Code Gen',
  2: 'Data Extract',
  3: 'Image Gen',
  4: 'Routing',
  5: 'DeFi Execute',
};

function capabilityLabel(bit: number): string {
  return CAPABILITY_LABELS[bit] ?? `bit-${bit}`;
}

function buildMockTaskVolume(): TaskVolumeData {
  return Array.from({ length: 90 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (89 - i));

    const taskCount = Math.round(120 + Math.sin(i / 7) * 28 + i * 1.6);
    const taskValueUsdc = Math.round(taskCount * 42 + (i % 6) * 85);
    const protocolFeeUsdc = Math.round(taskValueUsdc * 0.03);

    return {
      date: d.toISOString().slice(5, 10),
      taskCount,
      taskValueUsdc,
      protocolFeeUsdc,
      categories: {},
    };
  });
}

const mockTaskVolume = buildMockTaskVolume();

const mockBurnStats: BurnStats = {
  cumulativeBurned: 600_200_000_000,
  daily: mockTaskVolume.map((entry) => ({
    date: entry.date,
    burned: Math.max(1, Math.round(entry.protocolFeeUsdc * 1_000_000)),
  })),
};

const mockLeaderboard: LeaderboardAgent[] = Array.from({ length: 12 }, (_, i) => ({
  did: `did:saep:${('0'.repeat(60) + (i + 1).toString(16).padStart(4, '0')).slice(-64)}`,
  name: `agent-${String(i + 1).padStart(2, '0')}`,
  jobsCompleted: 980 - i * 57,
  totalEarnedUsdc: 24_000 - i * 1_250,
  reputationScore: 9_200 - i * 180,
}));

const mockNetworkHealth: NetworkHealth = {
  tps: 184,
  slotTimeMs: 400,
  finalityTimeMs: 6_200,
  status: 'healthy',
  lastUpdated: new Date().toISOString(),
};

const mockEconomyGraph: EconomyGraphData = {
  nodes: mockLeaderboard.map((agent, i) => ({
    id: agent.did,
    label: agent.name,
    category: capabilityLabel(i % 6),
    taskVolume: agent.jobsCompleted,
  })),
  edges: mockLeaderboard.slice(1).map((agent, i) => ({
    source: agent.did,
    target: mockLeaderboard[i % 3]!.did,
    frequency: Math.max(1, Math.round(agent.reputationScore / 100)),
  })),
};

const mockSnapshot = (): AnalyticsSnapshot => ({
  burnStats: mockBurnStats,
  economyGraph: mockEconomyGraph,
  taskVolume: mockTaskVolume,
  leaderboard: mockLeaderboard,
  networkHealth: {
    ...mockNetworkHealth,
    lastUpdated: new Date().toISOString(),
  },
  source: 'mock',
  fetchedAt: new Date().toISOString(),
});

function toLiveSnapshot(
  fees: RawFees,
  tasksPerDay: RawTaskDay[],
  health: RawNetworkHealth,
  topAgents: RawTopAgent[],
  graph: RawGraph,
): AnalyticsSnapshot {
  const topCapabilityByAgent = new Map<string, number>();

  for (const edge of graph.edges) {
    const previous = topCapabilityByAgent.get(edge.agent_did_hex);
    if (previous === undefined) {
      topCapabilityByAgent.set(edge.agent_did_hex, edge.capability_bit);
    }
  }

  return {
    burnStats: {
      cumulativeBurned: fees.protocol_fees_lamports + fees.solrep_fees_lamports,
      daily: tasksPerDay.map((entry) => ({
        date: entry.day,
        burned: Math.round(fees.last_24h_lamports / Math.max(tasksPerDay.length, 1)),
      })),
    },
    economyGraph: {
      nodes: graph.agents.map((agent) => ({
        id: `did:saep:${agent.agent_did_hex}`,
        label: agent.agent_did_hex.slice(0, 8),
        category: capabilityLabel(topCapabilityByAgent.get(agent.agent_did_hex) ?? 0),
        taskVolume: agent.jobs_completed,
      })),
      edges: graph.edges.slice(0, Math.max(graph.agents.length - 1, 0)).map((edge, index) => ({
        source: `did:saep:${edge.agent_did_hex}`,
        target:
          `did:saep:${graph.agents[(index + 1) % Math.max(graph.agents.length, 1)]?.agent_did_hex ?? edge.agent_did_hex}`,
        frequency: edge.composite_score,
      })),
    },
    taskVolume: tasksPerDay.map((entry) => ({
      date: entry.day,
      taskCount: entry.tasks,
      taskValueUsdc: 0,
      protocolFeeUsdc: 0,
      categories: {},
    })),
    leaderboard: topAgents.map((agent) => ({
      did: `did:saep:${agent.agent_did_hex}`,
      name: agent.agent_did_hex.slice(0, 8),
      jobsCompleted: agent.jobs_completed,
      totalEarnedUsdc: 0,
      reputationScore: agent.avg_score,
    })),
    networkHealth: {
      tps: health.events_per_min,
      slotTimeMs: 400,
      finalityTimeMs: 6_200,
      status: health.reorgs_24h < 5 ? 'healthy' : 'degraded',
      lastUpdated: new Date().toISOString(),
    },
    source: 'live',
    fetchedAt: new Date().toISOString(),
  };
}

export async function loadAnalyticsSnapshot(): Promise<AnalyticsSnapshot> {
  if (!INDEXER_URL) {
    return mockSnapshot();
  }

  try {
    const [_totals, tasksPerDay, fees, health, topAgents, graph] = await Promise.all([
      get<RawTotals>('/stats/totals'),
      get<RawTaskDay[]>('/stats/tasks-per-day?days=90'),
      get<RawFees>('/stats/fees-burned'),
      get<RawNetworkHealth>('/stats/network-health'),
      get<RawTopAgent[]>('/stats/top-agents?limit=20'),
      get<RawGraph>('/stats/agent-graph?limit=40'),
    ]);

    return toLiveSnapshot(fees, tasksPerDay, health, topAgents, graph);
  } catch (error) {
    console.warn('[portal/analytics] falling back to mock snapshot:', error);
    return mockSnapshot();
  }
}
