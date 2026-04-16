'use client';

import { useState } from 'react';
import type { TaskSummary } from '@saep/sdk';

const PAGE_SIZE = 10;

const STATUS_COLOR: Record<string, string> = {
  created: 'text-ink/60',
  funded: 'text-blue-500',
  inExecution: 'text-yellow-500',
  proofSubmitted: 'text-purple-500',
  verified: 'text-lime',
  released: 'text-lime',
  expired: 'text-danger',
  disputed: 'text-danger',
  resolved: 'text-ink/60',
};

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtSol(v: bigint): string {
  return `${(Number(v) / 1e9).toFixed(2)}`;
}

function hex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function JobHistoryTable({ tasks }: { tasks: TaskSummary[] }) {
  const [page, setPage] = useState(0);
  const sorted = [...tasks].sort((a, b) => b.createdAt - a.createdAt);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const visible = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="rounded-lg border border-ink/10 p-5 flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Job History</h2>
        <span className="text-[10px] text-ink/50">{tasks.length} total</span>
      </header>

      {tasks.length === 0 ? (
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
                  <th className="pb-2 pr-3 font-medium">Deadline</th>
                  <th className="pb-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((task) => (
                  <tr key={task.address.toBase58()} className="border-b border-ink/5">
                    <td className="py-2 pr-3 font-mono">
                      <a
                        href={`/tasks/${hex(task.taskId)}`}
                        className="hover:text-lime transition-colors"
                      >
                        {hex(task.taskId).slice(0, 8)}...
                      </a>
                    </td>
                    <td className={`py-2 pr-3 ${STATUS_COLOR[task.status] ?? ''}`}>
                      {task.status}
                    </td>
                    <td className="py-2 pr-3 font-mono">{fmtSol(task.paymentAmount)} SOL</td>
                    <td className="py-2 pr-3">{fmtDate(task.deadline)}</td>
                    <td className="py-2">{fmtDate(task.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-between text-xs text-ink/50">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="px-2 py-1 rounded hover:bg-ink/5 disabled:opacity-30"
              >
                Prev
              </button>
              <span>
                {page + 1} / {pageCount}
              </span>
              <button
                disabled={page >= pageCount - 1}
                onClick={() => setPage((p) => p + 1)}
                className="px-2 py-1 rounded hover:bg-ink/5 disabled:opacity-30"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
