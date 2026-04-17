import * as anchor from '@coral-xyz/anchor';
import { Clock, ProgramTestContext, startAnchor } from 'solana-bankrun';
import { BankrunProvider } from 'anchor-bankrun';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export interface BankrunEnv {
  context: ProgramTestContext;
  provider: BankrunProvider;
  wallet: anchor.Wallet;
}

export async function startBankrun(): Promise<BankrunEnv> {
  const context = await startAnchor(ROOT, [], []);
  const wallet = new anchor.Wallet(context.payer);
  const provider = new BankrunProvider(context, wallet);
  anchor.setProvider(provider);
  return { context, provider, wallet };
}

export function loadBankrunProgram<T extends anchor.Idl>(
  name: string,
  provider: BankrunProvider,
): anchor.Program<T> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const idl = require(`../../target/idl/${name}.json`) as T;
  return new anchor.Program<T>(idl, provider);
}

export async function warpClockBy(
  context: ProgramTestContext,
  seconds: number | bigint,
): Promise<Clock> {
  const current = await context.banksClient.getClock();
  const delta = BigInt(seconds);
  const nextSlot = current.slot + 1n;
  context.warpToSlot(nextSlot);
  const next = new Clock(
    nextSlot,
    current.epochStartTimestamp,
    current.epoch,
    current.leaderScheduleEpoch,
    current.unixTimestamp + delta,
  );
  context.setClock(next);
  return next;
}
