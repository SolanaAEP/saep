'use client';

import type { TaskDetail } from '@saep/sdk';

function hex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

function isZero(b: Uint8Array): boolean {
  return b.every((x) => x === 0);
}

function HashRow({ label, bytes }: { label: string; bytes: Uint8Array }) {
  const zero = isZero(bytes);
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] text-ink/50 uppercase tracking-wide">{label}</dt>
      <dd className="font-mono text-[11px] break-all text-ink/80">
        {zero ? <span className="text-ink/40 italic not-italic">— not yet submitted —</span> : hex(bytes)}
      </dd>
    </div>
  );
}

export function ProofViewer({ task }: { task: TaskDetail }) {
  const hasProof = !isZero(task.proofKey);
  const isVerified = task.verified;
  const didSubmit = ['proofSubmitted', 'verified', 'released', 'disputed', 'resolved'].includes(task.status);

  const badge = isVerified
    ? { label: 'Verified', color: 'text-lime bg-lime/10' }
    : didSubmit
      ? { label: 'Pending verification', color: 'text-yellow-500 bg-yellow-500/10' }
      : { label: 'Awaiting proof', color: 'text-ink/50 bg-ink/5' };

  return (
    <div className="border border-ink/10 p-5 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Proof</h2>
        <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${badge.color}`}>
          {badge.label}
        </span>
      </header>

      <dl className="flex flex-col gap-3">
        <HashRow label="Task hash" bytes={task.taskHash} />
        <HashRow label="Criteria root" bytes={task.criteriaRoot} />
        <HashRow label="Result hash" bytes={task.resultHash} />
        <HashRow label="Proof key" bytes={task.proofKey} />
      </dl>

      {hasProof && (
        <div className="border-t border-ink/10 pt-3 text-[10px] text-ink/50 flex flex-col gap-1">
          <div>Proof artifact addressed by proof key. Retrieve via proof-gen storage.</div>
          <div className="font-mono text-ink/80 break-all">proof://{hex(task.proofKey)}</div>
        </div>
      )}
    </div>
  );
}
