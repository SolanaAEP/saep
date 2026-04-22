'use client';

import { useEffect, useState, useCallback } from 'react';
import type { Program } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { useWallet } from '@solana/wallet-adapter-react';
import { useConnection } from '@solana/wallet-adapter-react';
import {
  buildCreateTaskIx,
  buildFundTaskIx,
  taskPda,
  type CreateTaskInput,
  type TaskMarket,
} from '@saep/sdk';
import {
  useSendTransaction,
  useTaskMarketProgram,
  useCluster,
  useTaskMarketConfig,
} from '@saep/sdk-ui';
import type { SerializedAgent } from '@/lib/agent-serializer';

function bytesFromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}

function firstCapabilityBit(mask: bigint): number {
  for (let bit = 0; bit < 128; bit++) {
    if ((mask & (1n << BigInt(bit))) !== 0n) return bit;
  }
  throw new Error('Agent has no declared capability bits');
}

type HireTaskInput = CreateTaskInput & {
  task: PublicKey;
  clientTokenAccount: PublicKey;
  tokenProgramId: PublicKey;
  paymentDecimals: number;
};

const KNOWN_MINTS: Record<string, { symbol: string; decimals: number }> = {
  So11111111111111111111111111111111111111112: { symbol: 'SOL', decimals: 9 },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', decimals: 6 },
  HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump: { symbol: 'SAEP', decimals: 6 },
};

function mintLabel(address: string): string {
  const known = KNOWN_MINTS[address];
  if (known) return `${known.symbol} (${address.slice(0, 4)}...${address.slice(-4)})`;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function guessDecimals(address: string): number {
  return KNOWN_MINTS[address]?.decimals ?? 6;
}

function toBaseUnits(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  if (!trimmed) return 0n;
  const normalized = trimmed.replace(/_/g, '');
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error('Payment amount must be a positive number');
  }
  const [whole, fraction = ''] = normalized.split('.');
  const paddedFraction = `${fraction}${'0'.repeat(decimals)}`.slice(0, decimals);
  return BigInt(`${whole}${paddedFraction}`);
}

interface Props {
  agent: SerializedAgent;
  onClose: () => void;
}

export function QuickHireModal({ agent, onClose }: Props) {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const program = useTaskMarketProgram() as Program<TaskMarket> | null;
  const cluster = useCluster();
  const { data: marketConfig } = useTaskMarketConfig();
  const [taskDescription, setTaskDescription] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [deadlineHours, setDeadlineHours] = useState('24');
  const [selectedMint, setSelectedMint] = useState('');
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedMint && marketConfig?.allowedPaymentMints[0]) {
      setSelectedMint(marketConfig.allowedPaymentMints[0].toBase58());
    }
  }, [marketConfig, selectedMint]);

  const selectedMintDecimals = guessDecimals(selectedMint);
  const valid = taskDescription.trim().length > 0
    && paymentAmount.trim().length > 0
    && parseInt(deadlineHours, 10) > 0
    && selectedMint.length > 0;

  const { mutate, isPending, error } = useSendTransaction<HireTaskInput>({
    buildInstruction: async (input) => [
      await buildCreateTaskIx(program!, cluster, input),
      await buildFundTaskIx(program!, {
        client: input.client,
        task: input.task,
        paymentMint: input.paymentMint,
        clientTokenAccount: input.clientTokenAccount,
        tokenProgramId: input.tokenProgramId,
      }),
    ],
    invalidateKeys: [['tasks'], ['task-market', 'recent']],
    priorityFee: 'auto',
  }, {
    onSuccess: (result) => {
      setLocalError(null);
      setTxSignature(result.signature);
    },
  });

  const handleSubmit = useCallback(async () => {
    if (!valid || !publicKey || !program || !selectedMint) return;

    try {
      setLocalError(null);

      const paymentMint = new PublicKey(selectedMint);
      const mintAccount = await connection.getAccountInfo(paymentMint, 'confirmed');
      if (!mintAccount) {
        throw new Error(`Payment mint ${selectedMint} was not found on the current cluster`);
      }

      const tokenProgramId = mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)
        ? TOKEN_2022_PROGRAM_ID
        : mintAccount.owner.equals(TOKEN_PROGRAM_ID)
          ? TOKEN_PROGRAM_ID
          : null;
      if (!tokenProgramId) {
        throw new Error('Selected payment mint is not owned by SPL Token or Token-2022');
      }

      const mint = await getMint(connection, paymentMint, 'confirmed', tokenProgramId);
      const paymentBaseUnits = toBaseUnits(paymentAmount, mint.decimals);
      if (paymentBaseUnits <= 0n) {
        throw new Error('Payment amount must be greater than zero');
      }

      const descBytes = new TextEncoder().encode(taskDescription);
      const argsHash = new Uint8Array(await crypto.subtle.digest('SHA-256', descBytes));
      const criteriaRoot = new Uint8Array(32);
      const nonce = crypto.getRandomValues(new Uint8Array(8));
      const deadlineSec = BigInt(Math.floor(Date.now() / 1000) + parseInt(deadlineHours, 10) * 3600);
      const [task] = taskPda(program.programId, publicKey, nonce);

      const didBytes = bytesFromHex(agent.did);
      const agentIdBytes = bytesFromHex(agent.agentId);
      const operatorKey = new PublicKey(agent.operator);
      const capabilityBit = firstCapabilityBit(BigInt(agent.capabilityMask));
      const clientTokenAccount = getAssociatedTokenAddressSync(
        paymentMint,
        publicKey,
        false,
        tokenProgramId,
      );

      mutate({
        client: publicKey,
        task,
        taskNonce: nonce,
        agentDid: didBytes,
        agentOperator: operatorKey,
        agentId: agentIdBytes,
        paymentMint,
        paymentAmount: paymentBaseUnits,
        payload: {
          kind: {
            generic: {
              capabilityBit,
              argsHash,
            },
          },
          capabilityBit,
          criteria: new Uint8Array(0),
        },
        clientTokenAccount,
        tokenProgramId,
        paymentDecimals: mint.decimals,
        criteriaRoot,
        deadline: deadlineSec,
        milestoneCount: 0,
      });
    } catch (submitError) {
      setLocalError((submitError as Error).message);
    }
  }, [valid, publicKey, program, selectedMint, connection, taskDescription, deadlineHours, agent, mutate, paymentAmount]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 px-4" onClick={onClose}>
      <div
        className="w-full max-w-xl border border-ink/10 bg-paper shadow-[0_24px_60px_rgba(0,0,0,0.16)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-ink/10 px-5 py-4 md:px-6">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
              Task market
            </div>
            <h2 className="mt-1 font-display text-[22px] tracking-[-0.01em]">Quick hire</h2>
            <p className="mt-1 text-sm text-ink/60">
              Create and fund a task for the selected agent in a single flow.
            </p>
          </div>
          <button
            onClick={onClose}
            className="font-mono text-[18px] leading-none text-ink/45 transition-colors hover:text-ink"
          >
            &times;
          </button>
        </header>

        <div className="flex flex-col gap-4 px-5 py-5 md:px-6">
          <p className="text-sm text-ink/60">
            Hiring{' '}
            <span className="font-mono text-[12px] text-ink">
              {agent.manifestUri || `${agent.did.slice(0, 12)}...`}
            </span>
          </p>

          {marketConfig?.paused && (
            <p className="border border-danger/30 bg-danger/5 px-3 py-3 text-sm text-danger">
              The task market is currently paused on-chain. New hires are disabled until the market
              resumes.
            </p>
          )}

          <label className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-mute">
              Task description
            </span>
            <textarea
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
              rows={4}
              className="border border-ink/15 bg-paper-2 px-3 py-3 text-sm leading-6 text-ink placeholder:text-mute focus:border-ink/35 focus:outline-none resize-none"
              placeholder="Describe the task..."
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-mute">
                Payment
              </span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className="border border-ink/15 bg-paper-2 px-3 py-3 font-mono text-sm text-ink focus:border-ink/35 focus:outline-none"
                placeholder="0.00"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-mute">
                Payment mint
              </span>
              <select
                value={selectedMint}
                onChange={(e) => setSelectedMint(e.target.value)}
                className="border border-ink/15 bg-paper-2 px-3 py-3 font-mono text-sm text-ink focus:border-ink/35 focus:outline-none"
                disabled={!marketConfig || marketConfig.allowedPaymentMints.length === 0}
              >
                {!marketConfig?.allowedPaymentMints.length && (
                  <option value="">No allowed mints</option>
                )}
                {marketConfig?.allowedPaymentMints.map((mint: PublicKey) => {
                  const address = mint.toBase58();
                  return (
                    <option key={address} value={address}>
                      {mintLabel(address)}
                    </option>
                  );
                })}
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-mute">
                Deadline (hours)
              </span>
              <input
                type="number"
                min="1"
                value={deadlineHours}
                onChange={(e) => setDeadlineHours(e.target.value)}
                className="border border-ink/15 bg-paper-2 px-3 py-3 font-mono text-sm text-ink focus:border-ink/35 focus:outline-none"
                placeholder="24"
              />
            </label>
          </div>

          <p className="text-[11px] leading-5 text-ink/45">
            Escrow is created and funded in one signature using the selected mint. Amount is
            interpreted with {selectedMintDecimals} decimals for UI preview until the chain mint
            metadata is fetched.
          </p>

          {localError && (
            <p className="border border-danger/30 bg-danger/5 px-3 py-3 text-sm text-danger">
              {localError}
            </p>
          )}

          {error && (
            <p className="border border-danger/30 bg-danger/5 px-3 py-3 text-sm text-danger">
              {(error as Error).message}
            </p>
          )}

          {txSignature && (
            <p className="border border-lime/30 bg-lime/5 px-3 py-3 text-sm text-ink">
              Task created:{' '}
              <a
                href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono underline decoration-ink/25 underline-offset-4"
              >
                {txSignature.slice(0, 12)}...
              </a>
            </p>
          )}

          <div className="flex flex-col gap-2 border-t border-ink/10 pt-5 sm:flex-row sm:justify-end">
            <button
              onClick={onClose}
              className="inline-flex h-11 items-center justify-center border border-ink/15 px-4 font-mono text-[11px] uppercase tracking-[0.08em] text-ink/70 transition-colors hover:border-ink/35 hover:text-ink"
            >
              {txSignature ? 'Close' : 'Cancel'}
            </button>
            {!txSignature && (
              <button
                onClick={handleSubmit}
                disabled={!valid || isPending || !publicKey || marketConfig?.paused}
                className="inline-flex h-11 items-center justify-center bg-ink px-4 font-mono text-[11px] uppercase tracking-[0.08em] text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isPending ? 'Signing...' : !publicKey ? 'Connect wallet' : 'Create + fund task'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
