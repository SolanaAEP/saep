import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import type { Program } from '@coral-xyz/anchor';
import type { TaskMarket } from '../generated/task_market.js';
import type { ClusterConfig } from '../cluster/index.js';
import {
  buildCreateTaskIx,
  buildFundTaskIx,
  type CreateTaskInput,
  type FundTaskInput,
} from '../programs/task_market.js';
import { taskPda } from '../pda/index.js';
import { computeTip, pickTipAccount } from './tip.js';
import { JitoBundleClient, type JitoConfig } from './client.js';

export interface HireAgentInput {
  createTask: CreateTaskInput;
  fundTask: Omit<FundTaskInput, 'task'>;
  tipLamports?: number;
  recentTipLamports?: number;
}

export interface HireAgentResult {
  bundleId?: string;
  signatures?: string[];
  fallback: boolean;
  taskAddress: PublicKey;
}

export async function buildHireAgentTx(
  program: Program<TaskMarket>,
  config: ClusterConfig,
  input: HireAgentInput,
): Promise<{ tx: Transaction; taskAddress: PublicKey }> {
  const createIx = await buildCreateTaskIx(program, config, input.createTask);
  const [task] = taskPda(program.programId, input.createTask.client, input.createTask.taskNonce);

  const fundIx = await buildFundTaskIx(program, {
    ...input.fundTask,
    task,
  });

  const tip = computeTip({
    recentTipLamports: input.recentTipLamports,
    taskPaymentLamports: input.createTask.paymentAmount,
  });
  const actualTip = input.tipLamports ?? tip;

  const tipIx = SystemProgram.transfer({
    fromPubkey: input.createTask.client,
    toPubkey: pickTipAccount(),
    lamports: actualTip,
  });

  const tx = new Transaction().add(createIx, fundIx, tipIx);
  return { tx, taskAddress: task };
}

export async function sendHireAgentBundle(
  program: Program<TaskMarket>,
  config: ClusterConfig,
  connection: Connection,
  input: HireAgentInput & { jitoConfig: JitoConfig; allowFallback?: boolean },
  sign: (tx: Transaction) => Promise<Transaction>,
): Promise<HireAgentResult> {
  const { tx, taskAddress } = await buildHireAgentTx(program, config, input);

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = input.createTask.client;

  const signed = await sign(tx);
  const client = new JitoBundleClient(input.jitoConfig);

  const result = await client.sendWithFallback([signed], {
    allowFallback: input.allowFallback,
  });

  return { ...result, taskAddress };
}

export async function buildSettlementBundle(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  opts?: { tipLamports?: number; taskPaymentLamports?: bigint; recentTipLamports?: number },
): Promise<Transaction> {
  const tip = computeTip({
    recentTipLamports: opts?.recentTipLamports,
    taskPaymentLamports: opts?.taskPaymentLamports,
  });

  const tipIx = SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: pickTipAccount(),
    lamports: opts?.tipLamports ?? tip,
  });

  return new Transaction().add(...instructions, tipIx);
}
