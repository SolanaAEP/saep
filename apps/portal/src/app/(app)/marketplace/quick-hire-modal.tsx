'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { Program } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import {
  getAccount,
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
import { solanaExplorerTxUrl } from '@/lib/mainnet-status';
import {
  formatBaseUnits,
  guessDecimals,
  mintLabel,
  mintSymbol,
  preferredPaymentMint,
  suggestedTinyAmount,
  toBaseUnits,
} from '@/lib/quick-hire';

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

type CreatedTaskReceipt = {
  signature: string;
  task: string;
  paymentAmount: string;
  paymentMint: string;
  paymentDecimals: number;
};

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
  const [createdTask, setCreatedTask] = useState<CreatedTaskReceipt | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const preferred = preferredPaymentMint(marketConfig?.allowedPaymentMints ?? []);
    if (!selectedMint && preferred) {
      setSelectedMint(preferred);
      setPaymentAmount((current) => current || suggestedTinyAmount(preferred));
    }
  }, [marketConfig, selectedMint]);

  const selectedMintDecimals = guessDecimals(selectedMint);
  const selectedMintSuggestion = selectedMint ? suggestedTinyAmount(selectedMint) : '1';
  const deadlineHoursValue = Number(deadlineHours);
  const deadlineValid = Number.isInteger(deadlineHoursValue) && deadlineHoursValue > 0;
  const agentActive = agent.status === 'active';
  const valid = taskDescription.trim().length > 0
    && paymentAmount.trim().length > 0
    && deadlineValid
    && selectedMint.length > 0
    && Boolean(marketConfig)
    && !marketConfig?.paused
    && agentActive;

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
    onSuccess: (result, input) => {
      setLocalError(null);
      setCreatedTask({
        signature: result.signature,
        task: input.task.toBase58(),
        paymentAmount: input.paymentAmount.toString(),
        paymentMint: input.paymentMint.toBase58(),
        paymentDecimals: input.paymentDecimals,
      });
    },
  });

  const handleSubmit = useCallback(async () => {
    if (!valid || !publicKey || !program || !selectedMint) return;

    try {
      setLocalError(null);
      setCreatedTask(null);

      if (!marketConfig) {
        throw new Error('Task market config is still loading. Try again in a moment.');
      }
      if (marketConfig.paused) {
        throw new Error('The task market is paused on-chain.');
      }
      if (!agentActive) {
        throw new Error(`Agent is ${agent.status}; Quick Hire requires an active agent.`);
      }

      const paymentMint = new PublicKey(selectedMint);
      const allowedPaymentMint = marketConfig.allowedPaymentMints.some((mint) =>
        mint.equals(paymentMint),
      );
      if (!allowedPaymentMint) {
        throw new Error(`${mintSymbol(selectedMint)} is not currently allowed by MarketGlobal.`);
      }

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

      const deadlineOffsetSec = BigInt(deadlineHoursValue) * 3600n;
      if (marketConfig.maxDeadlineSecs > 0n && deadlineOffsetSec > marketConfig.maxDeadlineSecs) {
        const maxHours = Number(marketConfig.maxDeadlineSecs / 3600n);
        throw new Error(`Deadline must be within ${maxHours} hours for this market.`);
      }

      const clientTokenAccount = getAssociatedTokenAddressSync(
        paymentMint,
        publicKey,
        false,
        tokenProgramId,
      );
      const tokenAccount = await getAccount(
        connection,
        clientTokenAccount,
        'confirmed',
        tokenProgramId,
      ).catch(() => null);
      const symbol = mintSymbol(selectedMint);
      if (!tokenAccount) {
        throw new Error(`Wallet needs an associated ${symbol} token account before funding.`);
      }
      if (tokenAccount.amount < paymentBaseUnits) {
        const needed = formatBaseUnits(paymentBaseUnits, mint.decimals, symbol);
        const available = formatBaseUnits(tokenAccount.amount, mint.decimals, symbol);
        throw new Error(`Insufficient ${symbol} balance: need ${needed}, available ${available}.`);
      }

      const descBytes = new TextEncoder().encode(taskDescription);
      const argsHash = new Uint8Array(await crypto.subtle.digest('SHA-256', descBytes));
      const criteriaRoot = new Uint8Array(32);
      const nonce = crypto.getRandomValues(new Uint8Array(8));
      const deadlineSec = BigInt(Math.floor(Date.now() / 1000)) + deadlineOffsetSec;
      const [task] = taskPda(program.programId, publicKey, nonce);

      const didBytes = bytesFromHex(agent.did);
      const agentIdBytes = bytesFromHex(agent.agentId);
      const operatorKey = new PublicKey(agent.operator);
      const capabilityBit = firstCapabilityBit(BigInt(agent.capabilityMask));

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
  }, [
    agent,
    agentActive,
    connection,
    deadlineHoursValue,
    marketConfig,
    mutate,
    paymentAmount,
    program,
    publicKey,
    selectedMint,
    taskDescription,
    valid,
  ]);

  const handleMintChange = useCallback((nextMint: string) => {
    const previousSuggestedAmount = selectedMint ? suggestedTinyAmount(selectedMint) : '';
    setSelectedMint(nextMint);
    setPaymentAmount((current) => {
      if (!current.trim() || current === previousSuggestedAmount) {
        return suggestedTinyAmount(nextMint);
      }
      return current;
    });
  }, [selectedMint]);

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

          {!agentActive && (
            <p className="border border-danger/30 bg-danger/5 px-3 py-3 text-sm text-danger">
              This agent is {agent.status}. Quick Hire is available for active agents only.
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
                onChange={(e) => handleMintChange(e.target.value)}
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
            Escrow is created and funded in one wallet signature using the selected mint. Public
            defaults stay tiny: {selectedMintSuggestion} {mintSymbol(selectedMint)}. Amount is
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

          {createdTask && (
            <div className="flex flex-col gap-2 border border-lime/30 bg-lime/5 px-3 py-3 text-sm text-ink">
              <p>Task submitted. The hosted board can take a moment to index the new escrow.</p>
              <p className="font-mono text-[11px] text-ink/70">
                Tx:{' '}
                <a
                  href={solanaExplorerTxUrl(createdTask.signature, cluster.cluster)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-ink/25 underline-offset-4"
                >
                  {createdTask.signature.slice(0, 12)}...
                </a>
              </p>
              <p className="font-mono text-[11px] text-ink/70">
                Task account: {createdTask.task.slice(0, 12)}...{createdTask.task.slice(-4)}
              </p>
              <p className="font-mono text-[11px] text-ink/70">
                Escrow:{' '}
                {formatBaseUnits(
                  createdTask.paymentAmount,
                  createdTask.paymentDecimals,
                  mintSymbol(createdTask.paymentMint),
                )}
              </p>
              <Link
                href="/tasks"
                className="text-xs font-medium text-ink underline decoration-ink/25 underline-offset-4"
              >
                Open task board
              </Link>
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-ink/10 pt-5 sm:flex-row sm:justify-end">
            <button
              onClick={onClose}
              className="inline-flex h-11 items-center justify-center border border-ink/15 px-4 font-mono text-[11px] uppercase tracking-[0.08em] text-ink/70 transition-colors hover:border-ink/35 hover:text-ink"
            >
              {createdTask ? 'Close' : 'Cancel'}
            </button>
            {!createdTask && (
              <button
                onClick={handleSubmit}
                disabled={!valid || isPending || !publicKey}
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
