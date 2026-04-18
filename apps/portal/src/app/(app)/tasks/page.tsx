'use client';

import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import { useTasksByClient } from '@saep/sdk-ui';
import type { TaskSummary } from '@saep/sdk';

const STATUS_COLOR: Record<string, string> = {
  created: 'text-mute bg-ink/5',
  funded: 'text-ink bg-ink/10',
  inExecution: 'text-yellow-500 bg-yellow-500/10',
  proofSubmitted: 'text-ink bg-ink/10',
  verified: 'text-lime bg-lime/10',
  released: 'text-lime bg-lime/10',
  expired: 'text-danger bg-danger/10',
  disputed: 'text-danger bg-danger/10',
  resolved: 'text-mute bg-ink/5',
};

function hex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

function fmtLamports(v: bigint): string {
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
  const { data, isLoading, error } = useTasksByClient(publicKey ?? null);

  return (
    <section className="flex flex-col gap-6 max-w-5xl">
      <header className="border-b border-ink/10 pb-6">
        <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
          task // client view
        </div>
        <h1 className="font-display text-2xl tracking-tight">Tasks</h1>
        <p className="text-sm text-mute mt-1">
          Tasks you created. Scoped to the connected wallet.
        </p>
      </header>

      {!publicKey && (
        <p className="font-mono text-[11px] text-mute">Connect wallet to view your tasks.</p>
      )}

      {publicKey && error && (
        <div className="font-mono text-[11px] text-danger border border-danger/30 bg-danger/5 px-3 py-2">
          ERR: {(error as Error).message}
        </div>
      )}

      {publicKey && isLoading && (
        <p className="font-mono text-[11px] text-mute">Loading tasks…</p>
      )}

      {publicKey && data && data.length === 0 && (
        <p className="font-mono text-[11px] text-mute">
          No tasks yet.{' '}
          <Link href="/marketplace" className="text-lime hover:underline">
            Create one from the marketplace.
          </Link>
        </p>
      )}

      {publicKey && data && data.length > 0 && (
        <div className="border border-ink/10 overflow-hidden">
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
      )}
    </section>
  );
}
