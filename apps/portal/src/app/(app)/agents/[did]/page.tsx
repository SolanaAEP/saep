'use client';

import { use } from 'react';
import { useAgent, useAgentTasks, useTreasury } from '@saep/sdk-ui';
import { maskToTags } from '../../dashboard/capability-tags';
import { ManifestViewer } from './manifest-viewer';
import { ReputationRadar } from './reputation-radar';
import { JobHistoryTable } from './job-history-table';
import { TreasuryTimeline } from './treasury-timeline';

const STATUS_COLOR: Record<string, string> = {
  active: 'text-lime bg-lime/10',
  paused: 'text-yellow-500 bg-yellow-500/10',
  suspended: 'text-danger bg-danger/10',
  deregistered: 'text-mute bg-mute/10',
};

function fmtSol(v: bigint): string {
  return `${(Number(v) / 1e9).toFixed(2)}`;
}

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function didFromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}

export default function AgentDetailPage({
  params,
}: {
  params: Promise<{ did: string }>;
}) {
  const { did } = use(params);
  const { data: agent, isLoading, error } = useAgent(did);
  const { data: tasks } = useAgentTasks(did);
  const { data: treasury } = useTreasury(did.length === 64 ? didFromHex(did) : null);

  if (isLoading) {
    return <p className="text-sm text-ink/50">Loading agent...</p>;
  }

  if (error) {
    return <p className="text-sm text-danger">Failed to load agent: {(error as Error).message}</p>;
  }

  if (!agent) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Agent not found</h1>
        <p className="text-sm text-ink/60">
          No agent with DID <span className="font-mono">{did.slice(0, 16)}...</span>
        </p>
      </div>
    );
  }

  const tags = maskToTags(agent.capabilityMask);

  return (
    <section className="flex flex-col gap-6 max-w-4xl">
      {/* header */}
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {agent.manifestUri || `Agent ${did.slice(0, 8)}...`}
          </h1>
          <span
            className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${STATUS_COLOR[agent.status] ?? ''}`}
          >
            {agent.status}
          </span>
        </div>
        <p className="text-xs font-mono text-ink/50">{did}</p>
      </header>

      {/* summary stats */}
      <dl className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-xs">
        <div>
          <dt className="text-ink/50">Operator</dt>
          <dd className="font-mono truncate">{agent.operator.toBase58()}</dd>
        </div>
        <div>
          <dt className="text-ink/50">Stake</dt>
          <dd className="font-mono">{fmtSol(agent.stakeAmount)} SOL</dd>
        </div>
        <div>
          <dt className="text-ink/50">Price</dt>
          <dd className="font-mono">{fmtSol(agent.priceLamports)} SOL</dd>
        </div>
        <div>
          <dt className="text-ink/50">Jobs</dt>
          <dd>{agent.jobsCompleted.toString()}</dd>
        </div>
        <div>
          <dt className="text-ink/50">Registered</dt>
          <dd>{fmtDate(agent.registeredAt)}</dd>
        </div>
      </dl>

      {/* capability tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t} className="text-[10px] px-2 py-0.5 rounded bg-ink/5 text-ink/70">
              {t}
            </span>
          ))}
        </div>
      )}

      {/* main grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ManifestViewer uri={agent.manifestUri} />
        <ReputationRadar reputation={agent.reputation} />
      </div>

      <TreasuryTimeline treasury={treasury ?? null} />

      <JobHistoryTable tasks={tasks ?? []} />
    </section>
  );
}
