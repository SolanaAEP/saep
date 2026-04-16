'use client';

import type { TaskDetail } from '@saep/sdk';

function fmtAmount(v: bigint, decimals = 9): string {
  return (Number(v) / 10 ** decimals).toFixed(decimals === 9 ? 4 : 2);
}

const LOCKED_STATES = new Set(['funded', 'inExecution', 'proofSubmitted', 'verified', 'disputed']);
const RELEASED_STATES = new Set(['released']);
const REFUNDED_STATES = new Set(['expired']);

export function EscrowPanel({ task }: { task: TaskDetail }) {
  const agentShare = task.paymentAmount - task.protocolFee - task.solrepFee;
  const locked = LOCKED_STATES.has(task.status);
  const released = RELEASED_STATES.has(task.status);
  const refunded = REFUNDED_STATES.has(task.status);

  const state = released ? 'Released' : refunded ? 'Refunded' : locked ? 'Locked' : 'Unfunded';
  const stateColor = released
    ? 'text-lime bg-lime/10'
    : refunded
      ? 'text-danger bg-danger/10'
      : locked
        ? 'text-blue-500 bg-blue-500/10'
        : 'text-ink/50 bg-ink/5';

  return (
    <div className="rounded-lg border border-ink/10 p-5 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Escrow</h2>
        <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${stateColor}`}>
          {state}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="text-ink/50">Payment mint</dt>
          <dd className="font-mono truncate" title={task.paymentMint.toBase58()}>
            {task.paymentMint.toBase58().slice(0, 8)}...{task.paymentMint.toBase58().slice(-4)}
          </dd>
        </div>
        <div>
          <dt className="text-ink/50">Total</dt>
          <dd className="font-mono">{fmtAmount(task.paymentAmount)}</dd>
        </div>
        <div>
          <dt className="text-ink/50">Agent share</dt>
          <dd className="font-mono text-lime">{fmtAmount(agentShare)}</dd>
        </div>
        <div>
          <dt className="text-ink/50">Protocol fee</dt>
          <dd className="font-mono">{fmtAmount(task.protocolFee)}</dd>
        </div>
        <div>
          <dt className="text-ink/50">Solrep fee</dt>
          <dd className="font-mono">{fmtAmount(task.solrepFee)}</dd>
        </div>
        <div>
          <dt className="text-ink/50">Milestones</dt>
          <dd>
            {task.milestonesComplete} / {task.milestoneCount}
          </dd>
        </div>
      </dl>

      {task.milestoneCount > 1 && (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-[10px] text-ink/50">
            <span>Milestone progress</span>
            <span>
              {Math.round((task.milestonesComplete / task.milestoneCount) * 100)}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-ink/10 overflow-hidden">
            <div
              className="h-full bg-lime transition-all"
              style={{ width: `${(task.milestonesComplete / task.milestoneCount) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
