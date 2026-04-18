'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useRaiseDispute } from '@saep/sdk-ui';
import type { TaskDetail } from '@saep/sdk';

const DISPUTABLE = new Set(['proofSubmitted', 'verified']);

export function DisputePanel({ task }: { task: TaskDetail }) {
  const { publicKey } = useWallet();
  const raise = useRaiseDispute();
  const [confirming, setConfirming] = useState(false);

  const isClient = publicKey?.equals(task.client) ?? false;
  const canDispute = isClient && DISPUTABLE.has(task.status);
  const alreadyDisputed = task.status === 'disputed';
  const windowOpen = task.disputeWindowEnd === 0 || Date.now() / 1000 < task.disputeWindowEnd;

  async function onRaise() {
    setConfirming(false);
    await raise.mutateAsync(task.address);
  }

  return (
    <div className="border border-dashed border-ink/20 p-5 flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Dispute</h2>
        <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 bg-ink/5 text-ink/50">
          M2 arbitration
        </span>
      </header>

      <p className="text-xs text-ink/60">
        M1 supports raising a dispute; full VRF-based arbitrator selection launches with M2 DisputeArbitration.
      </p>

      {alreadyDisputed ? (
        <div className="text-xs font-mono text-danger bg-danger/5 px-3 py-2">
          This task is in dispute. Resolution will be handled on-chain once arbitration is live.
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
              <button
                onClick={() => setConfirming(false)}
                className="px-3 py-1 text-ink/60 hover:bg-ink/5"
              >
                Cancel
              </button>
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
