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

        {marketConfig?.paused && (
          <p className="rounded bg-danger/10 px-3 py-2 text-xs text-danger">
            The task market is currently paused on-chain. New hires are disabled until the market resumes.
          </p>
        )}

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
            <span className="text-xs text-ink/70">Payment</span>
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
            <span className="text-xs text-ink/70">Payment mint</span>
            <select
              value={selectedMint}
              onChange={(e) => setSelectedMint(e.target.value)}
              className="rounded border border-ink/20 bg-transparent px-3 py-2 text-sm font-mono focus:border-lime/60 focus:outline-none"
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

        <p className="text-[11px] text-ink/45">
          Escrow is created and funded in one signature using the selected mint. Amount is interpreted with
          {` ${selectedMintDecimals} `}
          decimals for UI preview until the chain mint metadata is fetched.
        </p>

        {localError && (
          <p className="text-xs text-danger bg-danger/10 rounded px-3 py-2">{localError}</p>
        )}

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
              disabled={!valid || isPending || !publicKey || marketConfig?.paused}
              className="text-xs font-medium px-4 py-1.5 rounded bg-lime text-black hover:bg-lime/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              {isPending ? 'Signing...' : !publicKey ? 'Connect wallet' : 'Create + fund task'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
