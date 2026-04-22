'use client';

import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import { useDiscoveryTasks, useTasksByClient } from '@saep/sdk-ui';
import type { TaskSummary } from '@saep/sdk';
import { ComputeBondSummary } from '@/components/compute-bond-summary';
import { getPortalIndexerUrl } from '@/lib/indexer-url';

const STATUS_COLOR: Record<string, string> = {
  created: 'text-ink/60 bg-ink/5',
  funded: 'text-blue-500 bg-blue-500/10',
  inExecution: 'text-yellow-500 bg-yellow-500/10',
  proofSubmitted: 'text-purple-500 bg-purple-500/10',
  verified: 'text-lime bg-lime/10',
  released: 'text-lime bg-lime/10',
  expired: 'text-danger bg-danger/10',
  disputed: 'text-danger bg-danger/10',
  resolved: 'text-ink/60 bg-ink/5',
};

function hex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

function fmtLamports(v: bigint): string {
  return (Number(v) / 1e9).toFixed(4);
}

function fmtLamportsRaw(v: string | null): string {
  if (!v) return '—';
  return (Number(v) / 1e9).toFixed(4);
}

function fmtTs(ts: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function TasksPage() {
  const { publicKey } = useWallet();
  const indexerUrl = getPortalIndexerUrl();
  const { data, isLoading, error } = useTasksByClient(publicKey ?? null);
  const {
    data: indexedTasks,
    isLoading: recentLoading,
    error: recentError,
  } = useDiscoveryTasks({
    indexerUrl,
    limit: 20,
    statuses: ['created', 'funded', 'inExecution', 'proofSubmitted', 'verified', 'disputed'],
  });

  return (
    <section className="flex flex-col gap-6 max-w-5xl">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <p className="text-sm text-ink/60">
          Live task board plus the tasks created by the connected wallet.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-ink/60">Live board</h2>
          <p className="text-sm text-ink/50">Indexed task flow with broker-backed compute bond state when available.</p>
        </div>

        {recentError && (
          <p className="text-sm text-danger">
            Failed to load live tasks: {(recentError as Error).message}
          </p>
        )}

        {recentLoading && (
          <p className="text-sm text-ink/50">Loading live tasks...</p>
        )}

        {indexedTasks && indexedTasks.length === 0 && (
          <p className="text-sm text-ink/60">No live tasks yet.</p>
        )}

        {indexedTasks && indexedTasks.length > 0 && (
          <div className="rounded border border-ink/10 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-ink/5 text-ink/60">
                <tr>
                  <th className="text-left px-3 py-2">Task</th>
                  <th className="text-left px-3 py-2">Agent</th>
                  <th className="text-right px-3 py-2 w-28">Payment</th>
                  <th className="text-left px-3 py-2 w-40">Compute</th>
                  <th className="text-left px-3 py-2 w-28">Status</th>
                  <th className="text-right px-3 py-2 w-32">Created</th>
                </tr>
              </thead>
              <tbody>
                {indexedTasks.map((task) => {
                  const idHex = task.taskIdHex;
                  const didHex = task.agentDidHex;
                  const badge = STATUS_COLOR[task.status ?? ''] ?? 'text-ink/60 bg-ink/5';
                  return (
                    <tr
                      key={`recent-${idHex}`}
                      className="border-t border-ink/5 hover:bg-ink/5"
                    >
                      <td className="px-3 py-2">
                        <Link
                          href={`/tasks/${idHex}`}
                          className="font-mono text-ink hover:text-lime"
                        >
                          {idHex.slice(0, 12)}…{idHex.slice(-4)}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        {didHex ? (
                          <Link
                            href={`/agents/${didHex}`}
                            className="font-mono text-ink/70 hover:text-lime"
                          >
                            {didHex.slice(0, 10)}…{didHex.slice(-4)}
                          </Link>
                        ) : (
                          <span className="text-ink/40">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {fmtLamportsRaw(task.rewardLamports)}
                      </td>
                      <td className="px-3 py-2">
                        <ComputeBondSummary bonds={task.computeBonds} />
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${badge}`}
                        >
                          {task.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-ink/50">
                        {fmtTs(task.createdAtUnix)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!publicKey && (
        <p className="text-sm text-ink/60">Connect wallet to view the tasks you created.</p>
      )}

      {publicKey && error && (
        <p className="text-sm text-danger">
          Failed to load tasks: {(error as Error).message}
        </p>
      )}

      {publicKey && isLoading && (
        <p className="text-sm text-ink/50">Loading tasks...</p>
      )}

      {publicKey && data && data.length === 0 && (
        <p className="text-sm text-ink/60">
          No tasks yet.{' '}
          <Link href="/marketplace" className="text-lime hover:underline">
            Create one from the marketplace.
          </Link>
        </p>
      )}

      {publicKey && data && data.length > 0 && (
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-ink/60">Your tasks</h2>
            <p className="text-sm text-ink/50">Tasks created by the connected wallet.</p>
          </div>

          <div className="rounded border border-ink/10 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-ink/5 text-ink/60">
                <tr>
                  <th className="text-left px-3 py-2">Task</th>
                  <th className="text-left px-3 py-2">Agent</th>
                  <th className="text-right px-3 py-2 w-28">Payment</th>
                  <th className="text-left px-3 py-2 w-28">Status</th>
                  <th className="text-right px-3 py-2 w-32">Created</th>
                </tr>
              </thead>
              <tbody>
                {[...data]
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((task: TaskSummary) => {
                    const idHex = hex(task.taskId);
                    const didHex = hex(task.agentDid);
                    const badge = STATUS_COLOR[task.status] ?? 'text-ink/60 bg-ink/5';
                    return (
                      <tr
                        key={idHex}
                        className="border-t border-ink/5 hover:bg-ink/5"
                      >
                        <td className="px-3 py-2">
                          <Link
                            href={`/tasks/${idHex}`}
                            className="font-mono text-ink hover:text-lime"
                          >
                            {idHex.slice(0, 12)}…{idHex.slice(-4)}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/agents/${didHex}`}
                            className="font-mono text-ink/70 hover:text-lime"
                          >
                            {didHex.slice(0, 10)}…{didHex.slice(-4)}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {fmtLamports(task.paymentAmount)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${badge}`}
                          >
                            {task.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-ink/50">
                          {fmtTs(task.createdAt)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
