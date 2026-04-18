'use client';

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

function generateBurnMock(): BurnStats {
  const now = Date.now();
  const day = 86_400_000;
  const daily = Array.from({ length: 90 }, (_, i) => ({
    date: new Date(now - (89 - i) * day).toISOString().slice(0, 10),
    burned: Math.round(800 + Math.random() * 1200 + i * 15),
  }));
  return {
    cumulativeBurned: 2_847_312,
    daily,
  };
}

function generateEconomyMock(): EconomyGraphData {
  const categories = ['RAG', 'Code Gen', 'Data Extract', 'Image Gen', 'Routing', 'DeFi Execute'];
  const nodes = Array.from({ length: 30 }, (_, i) => ({
    id: `agent-${i.toString(16).padStart(4, '0')}`,
    label: `Agent ${i.toString(16).padStart(4, '0')}`,
    category: categories[i % categories.length] as string,
    taskVolume: Math.round(20 + Math.random() * 500),
  }));
  const edges: EconomyGraphData['edges'] = [];
  for (let i = 0; i < 60; i++) {
    const src = Math.floor(Math.random() * nodes.length);
    let dst = Math.floor(Math.random() * nodes.length);
    if (dst === src) dst = (dst + 1) % nodes.length;
    edges.push({
      source: nodes[src]!.id,
      target: nodes[dst]!.id,
      frequency: Math.round(1 + Math.random() * 40),
    });
  }
  return { nodes, edges };
}

function generateTaskVolumeMock(): TaskVolumeData {
  const now = Date.now();
  const day = 86_400_000;
  return Array.from({ length: 90 }, (_, i) => ({
    date: new Date(now - (89 - i) * day).toISOString().slice(0, 10),
    taskCount: Math.round(150 + Math.random() * 300 + i * 4),
    taskValueUsdc: Math.round(4200 + Math.random() * 8000 + i * 120),
    protocolFeeUsdc: Math.round(84 + Math.random() * 160 + i * 2.4),
    categories: {
      RAG: Math.round(30 + Math.random() * 60),
      'Code Gen': Math.round(25 + Math.random() * 50),
      'Data Extract': Math.round(20 + Math.random() * 40),
      'Image Gen': Math.round(15 + Math.random() * 35),
      Routing: Math.round(10 + Math.random() * 30),
      Other: Math.round(20 + Math.random() * 50),
    },
  }));
}

function generateLeaderboardMock(): LeaderboardAgent[] {
  const names = [
    'codex-prime', 'data-weaver', 'synthia-v3', 'parsec-rag', 'orbit-gen',
    'neural-scout', 'chain-link', 'flux-router', 'pixel-smith', 'quant-eye',
    'echo-search', 'atlas-node', 'drift-miner', 'helix-core', 'prism-net',
    'spark-agent', 'wave-parse', 'byte-forge', 'logic-flow', 'vortex-ai',
  ];
  return names.map((name, i) => ({
    did: `did:saep:${(0xa000 + i).toString(16)}${'0'.repeat(56)}`,
    name,
    jobsCompleted: Math.round(800 - i * 35 + Math.random() * 50),
    totalEarnedUsdc: Math.round(24000 - i * 1000 + Math.random() * 2000),
    reputationScore: Math.round(9800 - i * 200 + Math.random() * 100),
  }));
}

function generateNetworkHealthMock(): NetworkHealth {
  return {
    tps: 3842,
    slotTimeMs: 412,
    finalityTimeMs: 6200,
    status: 'healthy',
    lastUpdated: new Date().toISOString(),
  };
}

export default function AnalyticsPage() {
  const burnStats = generateBurnMock();
  const economyGraph = generateEconomyMock();
  const taskVolume = generateTaskVolumeMock();
  const leaderboard = generateLeaderboardMock();
  const networkHealth = generateNetworkHealthMock();

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
          <div className="text-lime">MOCK DATA</div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <FeesBurnedCounter stats={burnStats} />
        <NetworkHealthPanel health={networkHealth} />
      </div>

      <TaskVolumeChart data={taskVolume} />

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <AgentEconomyMap data={economyGraph} />
        <TopAgentsLeaderboard agents={leaderboard} />
      </div>
    </section>
  );
}
