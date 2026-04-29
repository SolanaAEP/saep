'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import { GlitchButton } from '@saep/ui';
import { useRaiseDispute, useAllDisputeCases } from '@saep/sdk-ui';
import type { TaskDetail } from '@saep/sdk';

const DISPUTABLE = new Set(['proofSubmitted', 'verified']);

function statusKey(status: Record<string, object>): string {
  return Object.keys(status)[0] ?? 'unknown';
}

const STATUS_LABELS: Record<string, string> = {
  requestedVrf: 'VRF Requested',
  selectionReady: 'Selection Ready',
  committing: 'Committing',
  revealing: 'Revealing',
  tallied: 'Tallied',
  appealed: 'Appealed',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
};

export function DisputePanel({ task }: { task: TaskDetail }) {
  const { publicKey } = useWallet();
  const raise = useRaiseDispute();
  const [confirming, setConfirming] = useState(false);
  const { data: allCases } = useAllDisputeCases();

  const isClient = publicKey?.equals(task.client) ?? false;
  const canDispute = isClient && DISPUTABLE.has(task.status);
  const alreadyDisputed = task.status === 'disputed';
  const windowOpen = task.disputeWindowEnd === 0 || Date.now() / 1000 < task.disputeWindowEnd;

  const linkedCase = useMemo(() => {
    if (!alreadyDisputed || !allCases) return null;
    const taskIdHex = Array.from(task.taskId).map((b) => b.toString(16).padStart(2, '0')).join('');
    return allCases.find((c) => {
      const caseTaskHex = c.taskId.toString();
      return caseTaskHex === taskIdHex || c.client.equals(task.client);
    }) ?? null;
  }, [alreadyDisputed, allCases, task]);

  async function onRaise() {
    setConfirming(false);
    await raise.mutateAsync(task.address);
  }

  return (
    <div className="border border-dashed border-ink/20 p-5 flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Dispute</h2>
        <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 bg-ink/5 text-ink/50">
          arbitration
        </span>
      </header>

      {alreadyDisputed ? (
        <div className="flex flex-col gap-3">
          <div className="text-xs font-mono text-danger bg-danger/5 px-3 py-2">
            This task is in dispute.
          </div>
          {linkedCase && (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <span className="text-ink/50">Case</span>
                <span className="font-mono">#{linkedCase.caseId.toString()}</span>
                <span className="text-ink/50">Status</span>
                <span className="font-mono">{STATUS_LABELS[statusKey(linkedCase.status)] ?? statusKey(linkedCase.status)}</span>
                <span className="text-ink/50">Arbitrators</span>
                <span>{linkedCase.arbitratorCount}</span>
              </div>
              <Link
                href={`/disputes/${linkedCase.caseId.toString()}`}
                className="self-start text-xs px-3 py-1.5 border border-ink/20 text-ink/70 hover:border-ink/40 hover:text-ink transition-colors"
              >
                View full case
              </Link>
            </div>
          )}
        </div>
      ) : canDispute && windowOpen ? (
        <div className="flex flex-col gap-2">
          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              className="self-start text-xs px-3 py-1.5 border border-danger/40 text-danger hover:bg-danger/10 transition-colors"
            >
              Raise dispute
            </button>
          ) : (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-ink/60">Confirm?</span>
              <button
                onClick={onRaise}
                disabled={raise.isPending}
                className="px-3 py-1 bg-danger text-white hover:bg-danger/90 disabled:opacity-50"
              >
                {raise.isPending ? 'Submitting...' : 'Yes, dispute'}
              </button>
              <GlitchButton variant="ghost" size="sm" onClick={() => setConfirming(false)}>Cancel</GlitchButton>
            </div>
          )}
          {raise.error && (
            <div className="text-[11px] text-danger">{(raise.error as Error).message}</div>
          )}
        </div>
      ) : (
        <div className="text-[11px] text-ink/50">
          {!isClient
            ? 'Only the task client can raise a dispute.'
            : !windowOpen
              ? 'Dispute window has closed.'
              : 'Task not in a disputable state.'}
        </div>
      )}
    </div>
  );
}
