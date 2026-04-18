'use client';

import { useState, useCallback } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { buildCreateTaskIx, type CreateTaskInput } from '@saep/sdk';
import { useSendTransaction, useTaskMarketProgram, useCluster } from '@saep/sdk-ui';
import type { SerializedAgent } from '@/lib/agent-serializer';
import { GlitchComposition } from '@/components/glitch-composition';

const USDC_DEVNET_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_DEFAULT_PAYMENT_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
);
const PAYMENT_DECIMALS = 6;

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
  const cluster = useCluster();
  const [taskDescription, setTaskDescription] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [deadlineHours, setDeadlineHours] = useState('24');
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const paymentBaseUnits = Math.round(parseFloat(paymentAmount || '0') * 10 ** PAYMENT_DECIMALS);
  const valid = taskDescription.length > 0 && paymentBaseUnits > 0 && parseInt(deadlineHours) > 0;

  const { mutate, isPending, error } = useSendTransaction<CreateTaskInput>({
    buildInstruction: async (input) => buildCreateTaskIx(program!, cluster, input),
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
    const agentIdBytes = bytesFromHex(agent.agentId);
    const operatorKey = new PublicKey(agent.operator);

    mutate({
      client: publicKey,
      taskNonce: nonce,
      agentDid: didBytes,
      agentOperator: operatorKey,
      agentId: agentIdBytes,
      paymentMint: USDC_DEVNET_MINT,
      paymentAmount: BigInt(paymentBaseUnits),
      taskHash,
      criteriaRoot,
      deadline: deadlineSec,
      milestoneCount: 0,
    });
  }, [valid, publicKey, program, taskDescription, deadlineHours, paymentBaseUnits, agent, mutate]);

  const inputClass = 'border border-ink/20 bg-transparent px-3 py-2 font-mono text-sm focus:border-lime focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="bg-paper border border-ink/20 w-full max-w-md flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative h-16 overflow-hidden border-b border-ink/10">
          <GlitchComposition seed={`hire-${agent.address}`} className="absolute inset-0 opacity-40" />
          <div className="relative px-5 py-3 flex items-center justify-between">
            <div>
              <div className="font-mono text-[9px] text-mute uppercase tracking-widest">Task Creation</div>
              <div className="font-mono text-xs mt-0.5">Quick Hire</div>
            </div>
            <button onClick={onClose} className="text-mute hover:text-ink text-lg leading-none font-mono">
              &times;
            </button>
          </div>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div className="font-mono text-[10px] text-mute border border-ink/10 px-3 py-2">
            TARGET: <span className="text-ink">{agent.manifestUri || `${agent.did.slice(0, 16)}...`}</span>
            <br />
            ADDR: <span className="text-ink">{agent.address.slice(0, 8)}...{agent.address.slice(-8)}</span>
          </div>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] text-mute uppercase">Task description</span>
            <textarea
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
              rows={3}
              className={`${inputClass} resize-none`}
              placeholder="Describe the task..."
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] text-mute uppercase">Payment (USDC)</span>
              <input
                type="number" step="0.01" min="0"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className={inputClass}
                placeholder="0.00"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] text-mute uppercase">Deadline (hours)</span>
              <input
                type="number" min="1"
                value={deadlineHours}
                onChange={(e) => setDeadlineHours(e.target.value)}
                className={inputClass}
                placeholder="24"
              />
            </label>
          </div>

          {error && (
            <div className="font-mono text-[11px] text-danger border border-danger/30 bg-danger/5 px-3 py-2">
              ERR: {(error as Error).message}
            </div>
          )}

          {txSignature && (
            <div className="font-mono text-[11px] text-lime border border-lime/30 bg-lime/5 px-3 py-2">
              TX CONFIRMED:{' '}
              <a href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
                 target="_blank" rel="noopener noreferrer" className="underline">
                {txSignature.slice(0, 16)}...
              </a>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2 border-t border-ink/10">
            <button
              onClick={onClose}
              className="font-mono text-[11px] px-4 py-2 border border-ink/20 text-mute hover:text-ink hover:border-ink/40 transition-colors"
            >
              {txSignature ? 'CLOSE' : 'CANCEL'}
            </button>
            {!txSignature && (
              <button
                onClick={handleSubmit}
                disabled={!valid || isPending || !publicKey}
                className="font-mono text-[11px] font-medium px-4 py-2 border border-lime text-lime hover:bg-lime hover:text-black disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
              >
                {isPending ? 'SIGNING...' : !publicKey ? 'CONNECT WALLET' : 'CREATE TASK'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
