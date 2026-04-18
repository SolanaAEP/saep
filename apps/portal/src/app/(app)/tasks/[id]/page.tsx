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
    return <p className="font-mono text-[11px] text-mute">Loading task…</p>;
  }

  if (error) {
    return <div className="font-mono text-[11px] text-danger border border-danger/30 bg-danger/5 px-3 py-2">ERR: {(error as Error).message}</div>;
  }

  if (!task) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl tracking-tight">Task not found</h1>
        <p className="font-mono text-[11px] text-mute">
          No task with ID {id.slice(0, 16)}…
        </p>
      </div>
    );
  }

  const didHex = hex(task.agentDid);

  return (
    <section className="flex flex-col gap-6 max-w-4xl">
      <header className="flex flex-col gap-2 border-b border-ink/10 pb-6">
        <div className="font-mono text-[10px] text-mute tracking-widest uppercase">
          task // {id.slice(0, 8)}
        </div>
        <h1 className="font-display text-2xl tracking-tight">Task {id.slice(0, 8)}…</h1>
        <p className="font-mono text-[10px] text-mute break-all">{id}</p>
        <div className="flex flex-wrap gap-4 font-mono text-[11px] text-mute pt-1">
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
