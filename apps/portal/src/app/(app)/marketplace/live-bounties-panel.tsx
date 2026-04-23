import Link from 'next/link';
import { findMarketplaceBountyByTaskHash } from '@saep/sdk';
import type { SerializedTask } from '@/lib/agent-serializer';
import { TaskMatchPreview } from './task-match-preview';

const STATUS_TONE: Record<string, string> = {
  created: 'border-ink/15 text-ink/55',
  funded: 'border-blue-500/30 text-blue-600',
  inExecution: 'border-amber-500/30 text-amber-600',
  proofSubmitted: 'border-fuchsia-500/30 text-fuchsia-600',
  verified: 'border-lime/30 text-lime',
  disputed: 'border-danger/30 text-danger',
};

function fmtAmount(baseUnits: string, mint: string, symbolOverride?: string): string {
  const amount = BigInt(baseUnits);
  const symbol =
    symbolOverride ??
    (mint === 'So11111111111111111111111111111111111111112'
      ? 'SOL'
      : mint === 'HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump'
        ? 'SAEP'
        : mint.slice(0, 4));
  const decimals = mint === 'So11111111111111111111111111111111111111112' ? 9 : 6;
  return `${(Number(amount) / 10 ** decimals).toFixed(2)} ${symbol}`;
}

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

export function LiveBountiesPanel({ tasks }: { tasks: SerializedTask[] }) {
  return (
    <section className="border border-ink/10 bg-paper">
      <div className="flex flex-col gap-4 border-b border-ink/10 px-5 py-4 md:flex-row md:items-end md:justify-between md:px-6">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-mute">Task feed</div>
          <h2 className="mt-1 font-display text-[22px] tracking-[-0.01em]">Live bounties</h2>
          <p className="mt-1 text-sm text-ink/60">
            Fresh on-chain tasks waiting for bids, execution, or proof settlement.
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
              return (
                <Link
                  key={task.address}
                  href={`/tasks/${task.taskId}`}
                  className="flex h-full flex-col border border-ink/10 bg-paper-2 px-4 py-4 transition-colors hover:border-ink/30"
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
                    <span
                      className={`inline-flex items-center border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] ${badge}`}
                    >
                      {statusLabel(task.status)}
                    </span>
                  </div>

                  <div className="mt-4 border-t border-ink/10 pt-4">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
                      Agent {task.agentDid.slice(0, 8)}…{task.agentDid.slice(-4)}
                    </div>
                  </div>

                  <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                    <DetailCell
                      label="Bounty"
                      value={fmtAmount(task.paymentAmount, task.paymentMint, bounty?.suggestedMint)}
                    />
                    <DetailCell label="Deadline" value={fmtTs(task.deadline)} />
                    <DetailCell label="Created" value={fmtTs(task.createdAt)} />
                    <DetailCell
                      label="Mint"
                      value={`${task.paymentMint.slice(0, 8)}…${task.paymentMint.slice(-4)}`}
                    />
                  </dl>

                  <div className="mt-4">
                    <TaskMatchPreview taskIdHex={task.taskId} />
                  </div>
                </Link>
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
