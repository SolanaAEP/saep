'use client';

import { useState, useCallback } from 'react';
import type { AgentDetail } from '@saep/sdk';

function hex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

interface Props {
  agent: AgentDetail;
  onClose: () => void;
}

export function QuickHireModal({ agent, onClose }: Props) {
  const [taskDescription, setTaskDescription] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [deadlineHours, setDeadlineHours] = useState('24');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const didHex = hex(agent.did);
  const paymentLamports = Math.round(parseFloat(paymentAmount || '0') * 1e9);
  const valid = taskDescription.length > 0 && paymentLamports > 0 && parseInt(deadlineHours) > 0;

  const handleSubmit = useCallback(async () => {
    if (!valid) return;
    setSubmitting(true);
    setError(null);

    try {
      // task spec hash = sha256 of description (placeholder — real impl uses structured spec)
      const descBytes = new TextEncoder().encode(taskDescription);
      const hashBuf = await crypto.subtle.digest('SHA-256', descBytes);
      const taskHash = new Uint8Array(hashBuf);
      const criteriaRoot = new Uint8Array(32); // empty criteria root for quick hire

      const nonce = crypto.getRandomValues(new Uint8Array(8));
      const deadlineSec = BigInt(Math.floor(Date.now() / 1000) + parseInt(deadlineHours) * 3600);

      // wire to useSendTransaction with buildHireAgentTx once wallet context is available
      setError(
        `Transaction ready: ${paymentLamports / 1e9} SOL to agent ${didHex.slice(0, 8)}..., deadline ${deadlineHours}h. Jito bundle submission requires wallet signature.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [valid, taskDescription, paymentLamports, deadlineHours, didHex]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-background border border-ink/10 rounded-xl p-6 w-full max-w-md flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Quick hire</h2>
          <button onClick={onClose} className="text-ink/50 hover:text-ink text-lg leading-none">
            &times;
          </button>
        </header>

        <p className="text-xs text-ink/60">
          Hiring <span className="font-mono text-ink">{agent.manifestUri || `${didHex.slice(0, 12)}...`}</span>
        </p>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink/70">Task description</span>
          <textarea
            value={taskDescription}
            onChange={(e) => setTaskDescription(e.target.value)}
            rows={3}
            className="rounded border border-ink/20 bg-transparent px-3 py-2 text-sm focus:border-lime/60 focus:outline-none resize-none"
            placeholder="Describe the task..."
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink/70">Payment (SOL)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              className="rounded border border-ink/20 bg-transparent px-3 py-2 text-sm font-mono focus:border-lime/60 focus:outline-none"
              placeholder="0.00"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink/70">Deadline (hours)</span>
            <input
              type="number"
              min="1"
              value={deadlineHours}
              onChange={(e) => setDeadlineHours(e.target.value)}
              className="rounded border border-ink/20 bg-transparent px-3 py-2 text-sm font-mono focus:border-lime/60 focus:outline-none"
              placeholder="24"
            />
          </label>
        </div>

        {error && (
          <p className="text-xs text-yellow-500 bg-yellow-500/10 rounded px-3 py-2">{error}</p>
        )}

        <div className="flex gap-2 justify-end pt-2">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-ink/20 text-ink/70 hover:border-ink/40"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!valid || submitting}
            className="text-xs font-medium px-4 py-1.5 rounded bg-lime text-black hover:bg-lime/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Preparing...' : 'Create task + fund (Jito bundle)'}
          </button>
        </div>
      </div>
    </div>
  );
}
