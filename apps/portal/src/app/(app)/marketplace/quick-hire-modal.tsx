'use client';

import { useState, useCallback, useMemo } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { buildCreateTaskIx, type CreateTaskInput } from '@saep/sdk';
import { useSendTransaction, useTaskMarketProgram } from '@saep/sdk-ui';
import type { SerializedAgent } from '@/lib/agent-serializer';

function bytesFromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}

interface Props {
  agent: SerializedAgent;
  onClose: () => void;
}

export function QuickHireModal({ agent, onClose }: Props) {
  const { publicKey } = useWallet();
  const program = useTaskMarketProgram();
  const [taskDescription, setTaskDescription] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [deadlineHours, setDeadlineHours] = useState('24');
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const paymentLamports = Math.round(parseFloat(paymentAmount || '0') * 1e9);
  const valid = taskDescription.length > 0 && paymentLamports > 0 && parseInt(deadlineHours) > 0;

  const { mutate, isPending, error } = useSendTransaction<CreateTaskInput>({
    buildInstruction: async (input) => buildCreateTaskIx(program!, input),
    invalidateKeys: [['tasks']],
    priorityFee: 'auto',
  }, {
    onSuccess: (result) => {
      setTxSignature(result.signature);
    },
  });

  const handleSubmit = useCallback(async () => {
    if (!valid || !publicKey || !program) return;

    const descBytes = new TextEncoder().encode(taskDescription);
    const hashBuf = await crypto.subtle.digest('SHA-256', descBytes);
    const taskHash = new Uint8Array(hashBuf);
    const criteriaRoot = new Uint8Array(32);
    const nonce = crypto.getRandomValues(new Uint8Array(8));
    const deadlineSec = BigInt(Math.floor(Date.now() / 1000) + parseInt(deadlineHours) * 3600);

    const didBytes = bytesFromHex(agent.did);
    const operatorKey = new PublicKey(agent.operator);

    mutate({
      client: publicKey,
      taskNonce: nonce,
      agentDid: didBytes,
      agentOperator: operatorKey,
      agentId: didBytes,
      paymentMint: publicKey, // fallback; real impl uses selected mint
      paymentAmount: BigInt(paymentLamports),
      taskHash,
      criteriaRoot,
      deadline: deadlineSec,
      milestoneCount: 0,
    });
  }, [valid, publicKey, program, taskDescription, deadlineHours, paymentLamports, agent, mutate]);

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
          Hiring <span className="font-mono text-ink">{agent.manifestUri || `${agent.did.slice(0, 12)}...`}</span>
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
          <p className="text-xs text-danger bg-danger/10 rounded px-3 py-2">{(error as Error).message}</p>
        )}

        {txSignature && (
          <p className="text-xs text-lime bg-lime/10 rounded px-3 py-2">
            Task created:{' '}
            <a href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
               target="_blank" rel="noopener noreferrer" className="underline font-mono">
              {txSignature.slice(0, 12)}...
            </a>
          </p>
        )}

        <div className="flex gap-2 justify-end pt-2">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-ink/20 text-ink/70 hover:border-ink/40"
          >
            {txSignature ? 'Close' : 'Cancel'}
          </button>
          {!txSignature && (
            <button
              onClick={handleSubmit}
              disabled={!valid || isPending || !publicKey}
              className="text-xs font-medium px-4 py-1.5 rounded bg-lime text-black hover:bg-lime/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              {isPending ? 'Signing...' : !publicKey ? 'Connect wallet' : 'Create task + fund'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
