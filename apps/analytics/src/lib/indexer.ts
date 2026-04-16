import {
  totals as mockTotals,
  tasksPerDay as mockTasksPerDay,
  topCapabilities as mockTopCapabilities,
  type Totals,
  type TasksPerDay,
  type CapabilityCount,
} from './mock-stats';

export type { Totals, TasksPerDay, CapabilityCount };

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

export type Snapshot = {
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

const BASE = process.env.INDEXER_URL ?? process.env.NEXT_PUBLIC_INDEXER_URL ?? '';
const TIMEOUT_MS = 4_000;

async function get<T>(path: string): Promise<T> {
  if (!BASE) throw new Error('INDEXER_URL not set');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      signal: ctrl.signal,
      next: { revalidate: 30 },
    });
    if (!res.ok) throw new Error(`indexer ${path} ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

type RawTotals = {
  agents: number;
  tasks: number;
  volume_lamports: number;
  active_streams: number;
};
type RawDay = { day: string; tasks: number };
type RawCap = { capability_bit: number; tasks: number };
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

const LAMPORTS_PER_SOL = 1_000_000_000;

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

const mockTopAgents: TopAgent[] = Array.from({ length: 10 }, (_, i) => ({
  agentDidHex: ('0'.repeat(60) + (i + 1).toString(16).padStart(4, '0')).slice(-64),
  avgScore: 9200 - i * 180,
  jobsCompleted: 980 - i * 60,
  categories: Math.max(1, 6 - Math.floor(i / 2)),
}));

const mockGraph: AgentGraph = {
  agents: mockTopAgents.map((a) => ({
    agentDidHex: a.agentDidHex,
    jobsCompleted: a.jobsCompleted,
    avgScore: a.avgScore,
  })),
  edges: mockTopAgents.flatMap((a, i) =>
    Array.from({ length: a.categories }, (_, k) => ({
      agentDidHex: a.agentDidHex,
      capabilityBit: (i + k) % 32,
      compositeScore: a.avgScore - k * 50,
    })),
  ),
};

export async function loadSnapshot(): Promise<Snapshot> {
  const fetchedAt = new Date().toISOString();
  if (!BASE) {
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
  try {
    const [totals, days, caps, fees, health, top, graph] = await Promise.all([
      get<RawTotals>('/stats/totals'),
      get<RawDay[]>('/stats/tasks-per-day?days=30'),
      get<RawCap[]>('/stats/top-capabilities?limit=10'),
      get<RawFees>('/stats/fees-burned'),
      get<RawHealth>('/stats/network-health'),
      get<RawTopAgent[]>('/stats/top-agents?limit=10'),
      get<RawGraph>('/stats/agent-graph?limit=40'),
    ]);
    return {
      totals: {
        agents: totals.agents,
        tasks: totals.tasks,
        volumeSol: totals.volume_lamports / LAMPORTS_PER_SOL,
        activeStreams: totals.active_streams,
      },
      tasksPerDay: days.map((d) => ({ day: d.day, tasks: d.tasks })),
      topCapabilities: caps.map((c) => ({
        capability: capabilityLabel(c.capability_bit),
        tasks: c.tasks,
      })),
      feesBurned: {
        protocolFeesLamports: fees.protocol_fees_lamports,
        solrepFeesLamports: fees.solrep_fees_lamports,
        last24hLamports: fees.last_24h_lamports,
      },
      health: {
        latestSlot: health.latest_slot,
        reorgs24h: health.reorgs_24h,
        eventsPerMin: health.events_per_min,
        eventsTotal: health.events_total,
        blocksTotal: health.blocks_total,
      },
      topAgents: top.map((a) => ({
        agentDidHex: a.agent_did_hex,
        avgScore: a.avg_score,
        jobsCompleted: a.jobs_completed,
        categories: a.categories,
      })),
      graph: {
        agents: graph.agents.map((a) => ({
          agentDidHex: a.agent_did_hex,
          jobsCompleted: a.jobs_completed,
          avgScore: a.avg_score,
        })),
        edges: graph.edges.map((e) => ({
          agentDidHex: e.agent_did_hex,
          capabilityBit: e.capability_bit,
          compositeScore: e.composite_score,
        })),
      },
      source: 'live',
      fetchedAt,
    };
  } catch (err) {
    console.warn('[analytics] indexer fetch failed, falling back to mock:', err);
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
}

const CAPABILITY_LABELS: Record<number, string> = {
  0: 'text-gen',
  1: 'code-review',
  2: 'data-label',
  3: 'image-gen',
  4: 'translate',
  5: 'summarize',
  6: 'audio-transcribe',
  7: 'video-edit',
  8: 'rag-retrieve',
  9: 'agent-orchestrate',
  10: 'web-scrape',
  11: 'sql-query',
  12: 'embedding',
  13: 'rerank',
  14: 'classify',
  15: 'sentiment',
  16: 'ocr',
  17: 'tts',
  18: 'stt',
  19: 'pdf-extract',
  20: 'browser-automate',
  21: 'shell-execute',
  22: 'fs-read',
  23: 'fs-write',
  24: 'http-call',
  25: 'rpc-solana',
  26: 'sign-message',
  27: 'simulate-tx',
  28: 'index-events',
  29: 'pin-ipfs',
  30: 'archive-arweave',
  31: 'finetune',
};

export function capabilityLabel(bit: number): string {
  return CAPABILITY_LABELS[bit] ?? `bit-${bit}`;
}
