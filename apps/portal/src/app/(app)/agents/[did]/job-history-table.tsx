'use client';

import { useState } from 'react';
import { useDiscoveryAgentTasks } from '@saep/sdk-ui';
import { GlitchButton } from '@saep/ui';
import { ComputeBondSummary } from '@/components/compute-bond-summary';
import { getPortalIndexerUrl } from '@/lib/indexer-url';
import type { SerializedTask } from '@/lib/agent-serializer';
import { formatPaymentAmount } from '@/lib/quick-hire';

const PAGE_SIZE = 10;

const STATUS_COLOR: Record<string, string> = {
  created: 'text-mute',
  funded: 'text-ink',
  inExecution: 'text-yellow-500',
  proofSubmitted: 'text-ink',
  verified: 'text-lime',
  released: 'text-lime',
  expired: 'text-danger',
  disputed: 'text-danger',
  resolved: 'text-mute',
};

function fmtDate(ts: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

type JobHistoryRow = {
  taskId: string;
  address: string;
  status: string | null;
  paymentAmount: string | null;
  paymentMint: string | null;
  deadline: number;
  createdAt: number;
  computeBonds: Parameters<typeof ComputeBondSummary>[0]['bonds'];
};

export function JobHistoryTable({
  agentDidHex,
  tasks,
}: {
  agentDidHex: string;
  tasks: SerializedTask[];
}) {
  const [page, setPage] = useState(0);
  const indexerUrl = getPortalIndexerUrl();
  const { data: indexedTasks } = useDiscoveryAgentTasks({
    indexerUrl,
    agentDidHex,
    limit: Math.max(tasks.length, 50),
  });
  const rows: JobHistoryRow[] = indexedTasks && indexedTasks.length > 0
    ? indexedTasks.map((task) => ({
        taskId: task.taskIdHex,
        address: task.taskIdHex,
        status: task.status,
        paymentAmount: task.rewardLamports,
        paymentMint: null,
        deadline: task.deadlineUnix ?? 0,
        createdAt: task.createdAtUnix,
        computeBonds: task.computeBonds,
      }))
    : tasks.map((task) => ({
        taskId: task.taskId,
        address: task.address,
        status: task.status,
        paymentAmount: task.paymentAmount,
        paymentMint: task.paymentMint,
        deadline: task.deadline,
        createdAt: task.createdAt,
        computeBonds: [],
      }));
  const sorted = [...rows].sort((a, b) => b.createdAt - a.createdAt);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const visible = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="border border-ink/10 p-5 flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Job History</h2>
        <span className="text-[10px] text-ink/50">{rows.length} total</span>
      </header>

      {rows.length === 0 ? (
        <p className="text-xs text-ink/50">No tasks found for this agent.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-ink/50 border-b border-ink/10">
                  <th className="pb-2 pr-3 font-medium">Task</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                  <th className="pb-2 pr-3 font-medium">Payment</th>
                  <th className="pb-2 pr-3 font-medium">Compute</th>
                  <th className="pb-2 pr-3 font-medium">Deadline</th>
                  <th className="pb-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((task) => (
                  <tr key={task.address} className="border-b border-ink/5">
                    <td className="py-2 pr-3 font-mono">
                      <a
                        href={`/tasks/${task.taskId}`}
                        className="hover:text-lime transition-colors"
                      >
                        {task.taskId.slice(0, 8)}...
                      </a>
                    </td>
                    <td className={`py-2 pr-3 ${STATUS_COLOR[task.status ?? ''] ?? ''}`}>
                      {task.status ?? 'unknown'}
                    </td>
                    <td className="py-2 pr-3 font-mono">
                      {formatPaymentAmount(task.paymentAmount, task.paymentMint)}
                    </td>
                    <td className="py-2 pr-3">
                      <ComputeBondSummary bonds={task.computeBonds} />
                    </td>
                    <td className="py-2 pr-3">{fmtDate(task.deadline)}</td>
                    <td className="py-2">{fmtDate(task.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-between text-xs text-ink/50">
              <GlitchButton variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</GlitchButton>
              <span>
                {page + 1} / {pageCount}
              </span>
              <GlitchButton variant="ghost" size="sm" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>Next</GlitchButton>
            </div>
          )}
        </>
      )}
    </div>
  );
}
