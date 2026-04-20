'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { FeesBurnedCounter } from './fees-burned';
import { TopAgentsLeaderboard } from './leaderboard';
import { NetworkHealthPanel } from './network-health';

const TaskVolumeChart = dynamic(
  () => import('./task-volume').then((m) => m.TaskVolumeChart),
  { ssr: false },
);
const AgentEconomyMap = dynamic(
  () => import('./economy-map').then((m) => m.AgentEconomyMap),
  { ssr: false },
);

import type { BurnStats } from './fees-burned';
import type { EconomyGraphData } from './economy-map';
import type { TaskVolumeData } from './task-volume';
import type { LeaderboardAgent } from './leaderboard';
import type { NetworkHealth } from './network-health';

const INDEXER_URL =
  process.env.NEXT_PUBLIC_INDEXER_URL ?? 'http://127.0.0.1:8080';

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${INDEXER_URL}${path}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function useAnalytics() {
  const [burnStats, setBurnStats] = useState<BurnStats | null>(null);
  const [economyGraph, setEconomyGraph] = useState<EconomyGraphData | null>(null);
  const [taskVolume, setTaskVolume] = useState<TaskVolumeData | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardAgent[] | null>(null);
  const [networkHealth, setNetworkHealth] = useState<NetworkHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);

  useEffect(() => {
    async function load() {
      const [totals, tasksPerDay, fees, health, topAgents, graph] = await Promise.all([
        fetchJson<{ agents: number; tasks: number; volume_lamports: number; active_streams: number }>('/stats/totals'),
        fetchJson<{ day: string; tasks: number }[]>('/stats/tasks-per-day?days=90'),
        fetchJson<{ protocol_fees_lamports: number; solrep_fees_lamports: number; last_24h_lamports: number }>('/stats/fees-burned'),
        fetchJson<{ latest_slot: number; reorgs_24h: number; events_per_min: number; events_total: number; blocks_total: number }>('/stats/network-health'),
        fetchJson<{ agent_did_hex: string; avg_score: number; jobs_completed: number; categories: number }[]>('/stats/top-agents?limit=20'),
        fetchJson<{ agents: { agent_did_hex: string; jobs_completed: number; avg_score: number }[]; edges: { agent_did_hex: string; capability_bit: number; composite_score: number }[] }>('/stats/agent-graph?limit=40'),
      ]);

      const hasData = totals !== null;
      setLive(hasData);

      if (fees) {
        const totalBurned = fees.protocol_fees_lamports + fees.solrep_fees_lamports;
        setBurnStats({
          cumulativeBurned: totalBurned,
          daily: tasksPerDay?.map((d) => ({
            date: d.day,
            burned: Math.round(fees.last_24h_lamports / 90),
          })) ?? [],
        });
      }

      if (tasksPerDay) {
        setTaskVolume(
          tasksPerDay.map((d) => ({
            date: d.day,
            taskCount: d.tasks,
            taskValueUsdc: 0,
            protocolFeeUsdc: 0,
            categories: {},
          })),
        );
      }

      if (health) {
        setNetworkHealth({
          tps: health.events_per_min,
          slotTimeMs: 400,
          finalityTimeMs: 6200,
          status: health.reorgs_24h < 5 ? 'healthy' : 'degraded',
          lastUpdated: new Date().toISOString(),
        });
      }

      if (topAgents) {
        setLeaderboard(
          topAgents.map((a) => ({
            did: a.agent_did_hex,
            name: `${a.agent_did_hex.slice(0, 8)}`,
            jobsCompleted: a.jobs_completed,
            totalEarnedUsdc: 0,
            reputationScore: a.avg_score,
          })),
        );
      }

      if (graph) {
        const capNames: Record<number, string> = {
          0: 'RAG', 1: 'Code Gen', 2: 'Data Extract',
          3: 'Image Gen', 4: 'Routing', 5: 'DeFi Execute',
        };
        setEconomyGraph({
          nodes: graph.agents.map((a) => ({
            id: a.agent_did_hex,
            label: a.agent_did_hex.slice(0, 8),
            category: 'Agent',
            taskVolume: a.jobs_completed,
          })),
          edges: graph.edges.map((e, i) => ({
            source: e.agent_did_hex,
            target: graph.agents[0]?.agent_did_hex ?? e.agent_did_hex,
            frequency: e.composite_score,
          })),
        });
      }

      setLoading(false);
    }
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, []);

  return { burnStats, economyGraph, taskVolume, leaderboard, networkHealth, loading, live };
}

export default function AnalyticsPage() {
  const { burnStats, economyGraph, taskVolume, leaderboard, networkHealth, loading, live } =
    useAnalytics();

  return (
    <section className="flex flex-col gap-6 max-w-6xl">
      <header className="flex items-end justify-between border-b border-ink/10 pb-6">
        <div>
          <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
            07 // protocol telemetry
          </div>
          <h1 className="font-display text-2xl tracking-tight">Analytics</h1>
          <p className="text-sm text-mute mt-1">Protocol-wide metrics and agent economy activity.</p>
        </div>
        <div className="font-mono text-[10px] text-mute text-right leading-relaxed">
          <div>90D WINDOW</div>
          <div className={live ? 'text-lime' : 'text-mute'}>
            {loading ? 'LOADING…' : live ? 'LIVE DATA' : 'NO DATA — INDEXER OFFLINE'}
          </div>
        </div>
      </header>

      {loading && (
        <p className="font-mono text-[11px] text-mute py-8 text-center">
          Fetching protocol telemetry…
        </p>
      )}

      {!loading && !live && (
        <div className="border border-ink/10 p-6 font-mono text-[11px] text-mute text-center">
          Analytics data will appear once the indexer is processing on-chain events.
        </div>
      )}

      {!loading && live && (
        <>
          <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
            {burnStats && <FeesBurnedCounter stats={burnStats} />}
            {networkHealth && <NetworkHealthPanel health={networkHealth} />}
          </div>

          {taskVolume && <TaskVolumeChart data={taskVolume} />}

          <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
            {economyGraph && <AgentEconomyMap data={economyGraph} />}
            {leaderboard && <TopAgentsLeaderboard agents={leaderboard} />}
          </div>
        </>
      )}
    </section>
  );
}
