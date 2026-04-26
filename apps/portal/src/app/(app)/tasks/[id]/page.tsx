'use client';

import { use } from 'react';
import Link from 'next/link';
import { useDiscoveryTaskDetail, useTask, useTaskComputeBonds } from '@saep/sdk-ui';
import { ComputeBondPanel } from '@/components/compute-bond-summary';
import { getPortalIndexerUrl } from '@/lib/indexer-url';
import { formatPaymentAmount } from '@/lib/quick-hire';
import { TaskStateTimeline } from './task-state-timeline';
import { EscrowPanel } from './escrow-panel';
import { ProofViewer } from './proof-viewer';
import { DisputePanel } from './dispute-panel';
import { BiddingPanel } from './bidding-panel';

function hex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

function fmtTs(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: task, isLoading, error } = useTask(id);
  const indexerUrl = getPortalIndexerUrl();
  const {
    data: computeBonds,
    isLoading: computeBondLoading,
    error: computeBondError,
  } = useTaskComputeBonds({ indexerUrl, taskIdHex: id });
  const {
    data: indexedTask,
    isLoading: indexedTaskLoading,
    error: indexedTaskError,
  } = useDiscoveryTaskDetail({ indexerUrl, taskIdHex: id });

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

      <div className="border border-ink/10 bg-paper px-4 py-3 text-xs">
        {indexedTask ? (
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <div className="text-ink/45">Hosted status</div>
              <div className="mt-1 font-mono">{indexedTask.status ?? 'unknown'}</div>
            </div>
            <div>
              <div className="text-ink/45">Indexed payment</div>
              <div className="mt-1 font-mono">
                {formatPaymentAmount(indexedTask.rewardLamports, null)}
              </div>
            </div>
            <div>
              <div className="text-ink/45">Created</div>
              <div className="mt-1 font-mono">{fmtTs(indexedTask.createdAtUnix)}</div>
            </div>
            <div>
              <div className="text-ink/45">Updated</div>
              <div className="mt-1 font-mono">{fmtTs(indexedTask.updatedAtUnix)}</div>
            </div>
          </div>
        ) : indexedTaskLoading ? (
          <p className="font-mono text-ink/50">Syncing hosted task detail...</p>
        ) : indexedTaskError ? (
          <p className="font-mono text-ink/50">
            Hosted task detail is still catching up: {(indexedTaskError as Error).message}
          </p>
        ) : (
          <p className="font-mono text-ink/50">Hosted task detail is not available yet.</p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <TaskStateTimeline task={task} />
        <EscrowPanel task={task} />
      </div>

      <ComputeBondPanel
        bonds={computeBonds}
        isLoading={computeBondLoading}
        error={computeBondError as Error | null}
      />

      <BiddingPanel taskIdHex={id} />

      <ProofViewer task={task} />

      <DisputePanel task={task} />
    </section>
  );
}
