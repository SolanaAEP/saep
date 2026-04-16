'use client';

import type { TaskDetail } from '@saep/sdk';

const FLOW: { key: string; label: string; ts: (t: TaskDetail) => number }[] = [
  { key: 'created', label: 'Created', ts: (t) => t.createdAt },
  { key: 'funded', label: 'Funded', ts: (t) => t.fundedAt },
  { key: 'inExecution', label: 'In Execution', ts: (t) => t.fundedAt },
  { key: 'proofSubmitted', label: 'Proof Submitted', ts: (t) => t.submittedAt },
  { key: 'verified', label: 'Verified', ts: (t) => t.submittedAt },
  { key: 'released', label: 'Released', ts: (t) => t.disputeWindowEnd },
];

const TERMINAL = new Set(['released', 'expired', 'disputed', 'resolved']);

const STATUS_COLOR: Record<string, { dot: string; text: string }> = {
  created: { dot: 'bg-ink/40', text: 'text-ink/60' },
  funded: { dot: 'bg-blue-500', text: 'text-blue-500' },
  inExecution: { dot: 'bg-yellow-500', text: 'text-yellow-500' },
  proofSubmitted: { dot: 'bg-purple-500', text: 'text-purple-500' },
  verified: { dot: 'bg-lime', text: 'text-lime' },
  released: { dot: 'bg-lime', text: 'text-lime' },
  expired: { dot: 'bg-danger', text: 'text-danger' },
  disputed: { dot: 'bg-danger', text: 'text-danger' },
  resolved: { dot: 'bg-ink/60', text: 'text-ink/60' },
};

function fmtTs(ts: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function orderOf(status: string): number {
  const map: Record<string, number> = {
    created: 0,
    funded: 1,
    inExecution: 2,
    proofSubmitted: 3,
    verified: 4,
    released: 5,
  };
  return map[status] ?? 5;
}

export function TaskStateTimeline({ task }: { task: TaskDetail }) {
  const currentOrder = orderOf(task.status);
  const terminal = TERMINAL.has(task.status);

  return (
    <div className="rounded-lg border border-ink/10 p-5 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">State Timeline</h2>
        <span
          className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-opacity-10 ${STATUS_COLOR[task.status]?.text ?? ''}`}
          style={{
            backgroundColor: STATUS_COLOR[task.status]
              ? `color-mix(in srgb, currentColor 10%, transparent)`
              : undefined,
          }}
        >
          {task.status}
        </span>
      </header>

      <ol className="flex flex-col gap-3">
        {FLOW.map((step, idx) => {
          const reached = idx <= currentOrder;
          const active = idx === currentOrder && !terminal;
          const ts = step.ts(task);
          const color = reached
            ? (STATUS_COLOR[step.key] ?? { dot: 'bg-ink/40', text: 'text-ink/60' })
            : { dot: 'bg-ink/20', text: 'text-ink/40' };
          return (
            <li key={step.key} className="flex items-center gap-3 text-xs">
              <span
                className={`h-2.5 w-2.5 rounded-full ${color.dot} ${active ? 'ring-2 ring-offset-2 ring-lime/50 animate-pulse' : ''}`}
              />
              <span className={`flex-1 ${reached ? '' : 'text-ink/40'}`}>{step.label}</span>
              <span className="font-mono text-ink/50">{reached ? fmtTs(ts) : '—'}</span>
            </li>
          );
        })}

        {terminal && task.status !== 'released' && (
          <li className="flex items-center gap-3 text-xs">
            <span className={`h-2.5 w-2.5 rounded-full ${STATUS_COLOR[task.status]?.dot ?? ''}`} />
            <span className={`flex-1 ${STATUS_COLOR[task.status]?.text ?? ''}`}>
              {task.status === 'expired' ? 'Expired' : task.status === 'disputed' ? 'Disputed' : 'Resolved'}
            </span>
            <span className="font-mono text-ink/50">{fmtTs(task.disputeWindowEnd)}</span>
          </li>
        )}
      </ol>

      <div className="grid grid-cols-2 gap-3 text-[10px] text-ink/50 border-t border-ink/10 pt-3">
        <div>
          <div>Deadline</div>
          <div className="font-mono text-ink/80">{fmtTs(task.deadline)}</div>
        </div>
        <div>
          <div>Dispute window end</div>
          <div className="font-mono text-ink/80">{fmtTs(task.disputeWindowEnd)}</div>
        </div>
      </div>
    </div>
  );
}
