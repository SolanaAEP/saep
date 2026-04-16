'use client';

import { use } from 'react';
import Link from 'next/link';
import { useTask } from '@saep/sdk-ui';
import { TaskStateTimeline } from './task-state-timeline';
import { EscrowPanel } from './escrow-panel';
import { ProofViewer } from './proof-viewer';
import { DisputePanel } from './dispute-panel';
import { BiddingPanel } from './bidding-panel';

function hex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: task, isLoading, error } = useTask(id);

  if (isLoading) {
    return <p className="text-sm text-ink/50">Loading task...</p>;
  }

  if (error) {
    return <p className="text-sm text-danger">Failed to load task: {(error as Error).message}</p>;
  }

  if (!task) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Task not found</h1>
        <p className="text-sm text-ink/60">
          No task with ID <span className="font-mono">{id.slice(0, 16)}...</span>
        </p>
      </div>
    );
  }

  const didHex = hex(task.agentDid);

  return (
    <section className="flex flex-col gap-6 max-w-4xl">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Task {id.slice(0, 8)}...</h1>
        <p className="text-xs font-mono text-ink/50 break-all">{id}</p>
        <div className="flex flex-wrap gap-4 text-xs text-ink/60 pt-1">
          <div>
            <span className="text-ink/50">Client:</span>{' '}
            <span className="font-mono">{task.client.toBase58().slice(0, 8)}...</span>
          </div>
          <div>
            <span className="text-ink/50">Agent:</span>{' '}
            <Link href={`/agents/${didHex}`} className="font-mono hover:text-lime transition-colors">
              {didHex.slice(0, 16)}...
            </Link>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <TaskStateTimeline task={task} />
        <EscrowPanel task={task} />
      </div>

      <BiddingPanel taskIdHex={id} />

      <ProofViewer task={task} />

      <DisputePanel task={task} />
    </section>
  );
}
