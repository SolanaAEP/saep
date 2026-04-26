'use client';

import Link from 'next/link';
import { findMarketplaceBountyByTaskHash } from '@saep/sdk';
import type { SerializedTask } from '@/lib/agent-serializer';
import { formatPaymentAmount, mintLabel } from '@/lib/agent-hire';
import { TaskMatchPreview } from './task-match-preview';

const STATUS_TONE: Record<string, string> = {
  created: 'border-ink/15 text-ink/55',
  funded: 'border-blue-500/30 text-blue-600',
  inExecution: 'border-amber-500/30 text-amber-600',
  proofSubmitted: 'border-fuchsia-500/30 text-fuchsia-600',
  verified: 'border-lime/30 text-lime',
  released: 'border-lime/30 text-lime',
  disputed: 'border-danger/30 text-danger',
};

function fmtTs(ts: number): string {
  if (!ts) return 'TBD';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts * 1000));
}

function statusLabel(status: string): string {
  return status
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (char) => char.toUpperCase());
}

interface Props {
  tasks: SerializedTask[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}

export function LiveBountiesPanel({ tasks, selectedTaskId, onSelectTask }: Props) {
  return (
    <section className="border border-ink/10 bg-paper">
      <div className="flex flex-col gap-4 border-b border-ink/10 px-5 py-4 md:flex-row md:items-end md:justify-between md:px-6">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-mute">Task feed</div>
          <h2 className="mt-1 font-display text-[22px] tracking-[-0.01em]">Live bounties</h2>
          <p className="mt-1 text-sm text-ink/60">
            Fresh on-chain tasks waiting for bids, execution, or settlement.
          </p>
        </div>
        <Link
          href="/tasks"
          className="inline-flex h-10 items-center border border-ink/15 px-4 font-mono text-[11px] uppercase tracking-[0.08em] text-ink/75 transition-colors hover:border-ink/35 hover:text-ink"
        >
          Open task board
        </Link>
      </div>

      <div className="px-5 py-5 md:px-6">
        {tasks.length === 0 ? (
          <div className="border border-dashed border-ink/15 px-5 py-5 text-sm text-ink/55">
            No live bounties are visible yet. Once tasks are funded, they will appear here as a
            structured on-chain feed.
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {tasks.map((task) => {
              const badge = STATUS_TONE[task.status] ?? 'border-ink/15 text-ink/55';
              const bounty = findMarketplaceBountyByTaskHash(task.catalogHash ?? task.taskHash);
              const isSelected = selectedTaskId === task.taskId;
              return (
                <article
                  key={task.address}
                  className={`flex h-full flex-col border px-4 py-4 transition-colors ${
                    isSelected
                      ? 'border-ink bg-paper'
                      : 'border-ink/10 bg-paper-2 hover:border-ink/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
                        Task {task.taskId.slice(0, 6)}…{task.taskId.slice(-4)}
                      </div>
                      <h3 className="mt-2 font-display text-[22px] leading-tight tracking-[-0.01em] text-ink">
                        {bounty?.title ?? `Bounty ${task.taskId.slice(0, 10)}…`}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-ink/65">
                        {bounty?.summary ?? 'On-chain bounty tracked through task_market.'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span
                        className={`inline-flex items-center border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] ${badge}`}
                      >
                        {statusLabel(task.status)}
                      </span>
                      {isSelected ? (
                        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink/55">
                          Ranking active
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 border-t border-ink/10 pt-4">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
                      Agent {task.agentDid.slice(0, 8)}…{task.agentDid.slice(-4)}
                    </div>
                  </div>

                  <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                    <DetailCell
                      label="Bounty"
                      value={formatPaymentAmount(task.paymentAmount, task.paymentMint)}
                    />
                    <DetailCell label="Deadline" value={fmtTs(task.deadline)} />
                    <DetailCell label="Created" value={fmtTs(task.createdAt)} />
                    <DetailCell
                      label="Mint"
                      value={mintLabel(task.paymentMint)}
                    />
                  </dl>

                  <div className="mt-4">
                    <TaskMatchPreview taskIdHex={task.taskId} />
                  </div>

                  <div className="mt-4 flex flex-col gap-3 border-t border-ink/10 pt-4 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => onSelectTask(task.taskId)}
                      className={`inline-flex h-11 items-center justify-center px-4 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors ${
                        isSelected
                          ? 'border border-ink/15 text-ink/70 hover:border-ink/35 hover:text-ink'
                          : 'bg-ink text-paper hover:opacity-90'
                      }`}
                    >
                      {isSelected ? 'Using for ranking' : 'Rank agents for this task'}
                    </button>
                    <Link
                      href={`/tasks/${task.taskId}`}
                      className="inline-flex h-11 items-center justify-center border border-ink/15 px-4 font-mono text-[11px] uppercase tracking-[0.08em] text-ink/75 transition-colors hover:border-ink/35 hover:text-ink"
                    >
                      Open task
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function DetailCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-ink/10 bg-paper px-3 py-3 text-sm">
      <dt className="font-mono text-[10px] uppercase tracking-widest text-mute">{label}</dt>
      <dd className="mt-2 font-mono text-[12px] text-ink">{value}</dd>
    </div>
  );
}
