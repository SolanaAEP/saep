import Link from 'next/link';
import { findMarketplaceBountyByTaskHash } from '@saep/sdk';
import type { SerializedTask } from '@/lib/agent-serializer';

const STATUS_TONE: Record<string, string> = {
  created: 'text-ink/60 bg-ink/5',
  funded: 'text-blue-500 bg-blue-500/10',
  inExecution: 'text-amber-500 bg-amber-500/10',
  proofSubmitted: 'text-fuchsia-500 bg-fuchsia-500/10',
  verified: 'text-lime bg-lime/10',
  disputed: 'text-danger bg-danger/10',
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

export function LiveBountiesPanel({ tasks }: { tasks: SerializedTask[] }) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink/15 p-5 text-sm text-ink/55">
        No live bounties yet. Seed devnet tasks to turn the marketplace into a real task feed.
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Live bounties</h2>
          <p className="text-sm text-ink/60">
            Fresh on-chain tasks waiting for bids, execution, or proof settlement.
          </p>
        </div>
        <Link href="/tasks" className="text-xs text-lime hover:underline">
          Open task board
        </Link>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {tasks.map((task) => {
          const badge = STATUS_TONE[task.status] ?? 'text-ink/60 bg-ink/5';
          const bounty = findMarketplaceBountyByTaskHash(task.catalogHash ?? task.taskHash);
          return (
            <Link
              key={task.address}
              href={`/tasks/${task.taskId}`}
              className="rounded-xl border border-ink/10 bg-white/50 p-4 transition-colors hover:border-lime/40 hover:bg-lime/5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <div className="text-sm font-medium text-ink">
                    {bounty?.title ?? `Task ${task.taskId.slice(0, 12)}...${task.taskId.slice(-4)}`}
                  </div>
                  <div className="text-xs text-ink/55">
                    {bounty?.summary ?? 'On-chain bounty tracked through task_market.'}
                  </div>
                  <div className="text-xs font-mono text-ink/45">
                    Agent {task.agentDid.slice(0, 10)}...{task.agentDid.slice(-4)}
                  </div>
                </div>
                <span className={`rounded px-2 py-1 text-[10px] font-mono uppercase ${badge}`}>
                  {task.status}
                </span>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-ink/45">Bounty</dt>
                  <dd className="font-mono text-ink">
                    {fmtAmount(task.paymentAmount, task.paymentMint, bounty?.suggestedMint)}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink/45">Deadline</dt>
                  <dd className="font-mono text-ink">{fmtTs(task.deadline)}</dd>
                </div>
                <div>
                  <dt className="text-ink/45">Created</dt>
                  <dd className="font-mono text-ink">{fmtTs(task.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-ink/45">Mint</dt>
                  <dd className="font-mono text-ink">
                    {task.paymentMint.slice(0, 8)}...{task.paymentMint.slice(-4)}
                  </dd>
                </div>
              </dl>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
