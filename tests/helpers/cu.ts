import * as anchor from '@coral-xyz/anchor';
import { Keypair, Transaction } from '@solana/web3.js';
import { ProgramTestContext } from 'solana-bankrun';

export interface CUMeasurement {
  label: string;
  cu: number;
  budget: number | null;
}

const measurements: CUMeasurement[] = [];

export const CU_BUDGETS: Record<string, number> = {
  init_global: 50_000,
  init_guard: 30_000,
  register_agent: 200_000,
  stake_increase: 200_000,
  stake_withdraw_request: 100_000,
  stake_withdraw_execute: 200_000,
  propose_slash: 150_000,
  cancel_slash: 100_000,
  execute_slash: 200_000,
  initialize: 50_000,
  propose_tag: 80_000,
  retire_tag: 30_000,
  validate_mask: 20_000,
  update_manifest_uri: 30_000,
  set_tag_personhood: 30_000,
  set_paused: 20_000,
  create_task: 200_000,
  cancel_task: 150_000,
  cancel_unfunded_task: 80_000,
  cancel_bidding: 40_000,
  expire: 80_000,
  commit_bid: 150_000,
  reveal_bid: 200_000,
  accept_bid: 200_000,
  submit_proof: 300_000,
  dispute_open: 200_000,
  dispute_resolve: 250_000,
  init_treasury: 60_000,
  fund_treasury: 100_000,
  withdraw: 80_000,
  init_stream: 120_000,
};

export async function measureCU(
  context: ProgramTestContext,
  methodBuilder: anchor.web3.TransactionInstruction | { instruction(): Promise<anchor.web3.TransactionInstruction> },
  payer: Keypair,
  signers: Keypair[] = [],
): Promise<number> {
  const ix = 'instruction' in methodBuilder
    ? await methodBuilder.instruction()
    : methodBuilder;

  const tx = new Transaction().add(ix);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = context.lastBlockhash;
  tx.sign(payer, ...signers);

  const sim = await context.banksClient.simulateTransaction(tx);
  if (sim.result) {
    throw new Error(`simulation failed: ${sim.result}`);
  }
  const cu = sim.meta?.computeUnitsConsumed;
  if (cu == null) throw new Error('simulation did not return CU metadata');
  return Number(cu);
}

export function logCU(label: string, cu: number): void {
  const budget = CU_BUDGETS[label] ?? null;
  measurements.push({ label, cu, budget });
  const pct = budget ? ` (${((cu / budget) * 100).toFixed(1)}% of ${budget.toLocaleString()} budget)` : '';
  console.log(`  ⚡ ${label}: ${cu.toLocaleString()} CU${pct}`);
}

export function assertWithinBudget(label: string, measured: number, budget: number): void {
  if (measured > budget) {
    throw new Error(
      `${label} exceeded CU budget: ${measured.toLocaleString()} > ${budget.toLocaleString()}`,
    );
  }
}

export function printCUSummary(): void {
  if (measurements.length === 0) return;

  const labelWidth = Math.max(...measurements.map((m) => m.label.length), 10);
  const divider = '-'.repeat(labelWidth + 40);

  console.log('\n' + divider);
  console.log(
    'Instruction'.padEnd(labelWidth + 2)
    + 'CU'.padStart(10)
    + 'Budget'.padStart(10)
    + '  %'.padStart(8),
  );
  console.log(divider);

  for (const m of measurements) {
    const cuStr = m.cu.toLocaleString().padStart(10);
    const budgetStr = m.budget ? m.budget.toLocaleString().padStart(10) : '       n/a';
    const pctStr = m.budget
      ? `${((m.cu / m.budget) * 100).toFixed(1)}%`.padStart(8)
      : '     n/a';
    console.log(`${m.label.padEnd(labelWidth + 2)}${cuStr}${budgetStr}${pctStr}`);
  }

  console.log(divider + '\n');
}

export function resetCUMeasurements(): void {
  measurements.length = 0;
}
