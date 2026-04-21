'use client';

import { useState, useCallback, useEffect } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { buildCreateTaskIx, marketGlobalPda, type CreateTaskInput } from '@saep/sdk';
import { useSendTransaction, useTaskMarketProgram, useCluster } from '@saep/sdk-ui';
import type { SerializedAgent } from '@/lib/agent-serializer';
import { GlitchComposition, GlitchButton } from '@saep/ui';

const PAYMENT_DECIMALS = 6;

function bytesFromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}

function firstCapabilityBit(mask: string): number {
  const bits = BigInt(mask);
  for (let bit = 0; bit < 128; bit += 1) {
    if ((bits & (1n << BigInt(bit))) !== 0n) return bit;
  }
  return 0;
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
  const [paymentMint, setPaymentMint] = useState<PublicKey | null>(null);
  const [paymentMintError, setPaymentMintError] = useState<string | null>(null);

  const trimmedDescription = taskDescription.trim();
  const paymentBaseUnits = Math.round(parseFloat(paymentAmount || '0') * 10 ** PAYMENT_DECIMALS);
  const valid =
    trimmedDescription.length > 0 &&
    paymentBaseUnits > 0 &&
    parseInt(deadlineHours) > 0 &&
    paymentMint !== null;

  const { mutate, isPending, error } = useSendTransaction<CreateTaskInput>({
    buildInstruction: async (input) => buildCreateTaskIx(program!, cluster, input),
    invalidateKeys: [['tasks']],
    priorityFee: 'auto',
  }, {
    onSuccess: (result) => {
      setTxSignature(result.signature);
    },
  });

  useEffect(() => {
    let cancelled = false;

    async function loadPaymentMint() {
      if (!program) {
        if (!cancelled) {
          setPaymentMint(null);
          setPaymentMintError(null);
        }
        return;
      }

      try {
        const [globalAddress] = marketGlobalPda(program.programId);
        const global = await program.account.marketGlobal.fetchNullable(globalAddress);
        const nextMint =
          global?.allowedPaymentMints.find((mint: PublicKey) => !mint.equals(PublicKey.default)) ?? null;

        if (!cancelled) {
          setPaymentMint(nextMint);
          setPaymentMintError(nextMint ? null : 'Task market has no allowed payment mint configured.');
        }
      } catch (err) {
        if (!cancelled) {
          setPaymentMint(null);
          setPaymentMintError(err instanceof Error ? err.message : 'Unable to load payment mint.');
        }
      }
    }

    void loadPaymentMint();
    return () => {
      cancelled = true;
    };
  }, [program]);

  const handleSubmit = useCallback(async () => {
    if (!valid || !publicKey || !program || !paymentMint) return;

    const descBytes = new TextEncoder().encode(trimmedDescription);
    const hashBuf = await crypto.subtle.digest('SHA-256', descBytes);
    const argsHash = new Uint8Array(hashBuf);
    const criteriaRoot = new Uint8Array(32);
    const nonce = crypto.getRandomValues(new Uint8Array(8));
    const deadlineSec = BigInt(Math.floor(Date.now() / 1000) + parseInt(deadlineHours) * 3600);

    const didBytes = bytesFromHex(agent.did);
    const agentIdBytes = bytesFromHex(agent.agentId);
    const operatorKey = new PublicKey(agent.operator);
    const capabilityBit = firstCapabilityBit(agent.capabilityMask);

    mutate({
      client: publicKey,
      taskNonce: nonce,
      agentDid: didBytes,
      agentOperator: operatorKey,
      agentId: agentIdBytes,
      paymentMint,
      paymentAmount: BigInt(paymentBaseUnits),
      payload: {
        kind: {
          type: 'generic',
          capabilityBit,
          argsHash,
        },
        capabilityBit,
        criteria: descBytes,
        requiresPersonhood: 'none',
      },
      criteriaRoot,
      deadline: deadlineSec,
      milestoneCount: 1,
    });
  }, [valid, publicKey, program, paymentMint, trimmedDescription, deadlineHours, paymentBaseUnits, agent, mutate]);

  const inputClass = 'border border-ink/20 bg-transparent px-3 py-2 font-mono text-sm focus:border-lime focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="bg-paper border border-ink/20 w-full max-w-md flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hire-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative h-16 overflow-hidden border-b border-ink/10">
          <GlitchComposition seed={`hire-${agent.address}`} className="absolute inset-0 opacity-40" />
          <div className="relative px-5 py-3 flex items-center justify-between">
            <div>
              <div className="font-mono text-[9px] text-mute uppercase tracking-widest">Task Creation</div>
              <div id="hire-modal-title" className="font-mono text-xs mt-0.5">Quick Hire</div>
            </div>
            <button onClick={onClose} aria-label="Close" className="text-mute hover:text-ink text-lg leading-none font-mono">
              &times;
            </button>
          </div>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div className="font-mono text-[10px] text-mute border border-ink/10 px-3 py-2">
            TARGET: <span className="text-ink">{agent.manifestUri || `${agent.did.slice(0, 16)}...`}</span>
            <br />
            ADDR: <span className="text-ink">{agent.address.slice(0, 8)}...{agent.address.slice(-8)}</span>
            <br />
            MINT: <span className="text-ink">{paymentMint ? `${paymentMint.toBase58().slice(0, 8)}...${paymentMint.toBase58().slice(-8)}` : 'LOADING...'}</span>
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
              <span className="font-mono text-[10px] text-mute uppercase">Payment amount</span>
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

          {paymentMintError && (
            <div className="font-mono text-[11px] text-danger border border-danger/30 bg-danger/5 px-3 py-2">
              MINT ERR: {paymentMintError}
            </div>
          )}

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
            <GlitchButton variant="ghost" onClick={onClose}>
              {txSignature ? 'CLOSE' : 'CANCEL'}
            </GlitchButton>
            {!txSignature && (
              <GlitchButton variant="solid" onClick={handleSubmit} disabled={!valid || isPending || !publicKey}>
                {isPending ? 'SIGNING...' : !publicKey ? 'CONNECT WALLET' : !paymentMint ? 'LOADING MINT' : 'CREATE TASK'}
              </GlitchButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
