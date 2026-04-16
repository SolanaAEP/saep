import { z } from 'zod';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

const pubkey = z.instanceof(PublicKey);
const bn = z.instanceof(BN);

export const StreamStatusSchema = z.enum(['active', 'closed']);

export const TreasuryGlobalSchema = z.object({
  authority: pubkey,
  pendingAuthority: pubkey.nullable(),
  agentRegistry: pubkey,
  jupiterProgram: pubkey,
  allowedMints: pubkey,
  maxStreamDuration: bn,
  defaultDailyLimit: bn,
  maxDailyLimit: bn,
  paused: z.boolean(),
  bump: z.number(),
});

export const AgentTreasurySchema = z.object({
  agentDid: z.array(z.number()).length(32),
  operator: pubkey,
  dailySpendLimit: bn,
  perTxLimit: bn,
  weeklyLimit: bn,
  spentToday: bn,
  spentThisWeek: bn,
  lastResetDay: bn,
  lastResetWeek: bn,
  streamingActive: z.boolean(),
  streamCounterparty: pubkey.nullable(),
  streamRatePerSec: bn,
  bump: z.number(),
});

export const AllowedMintsSchema = z.object({
  authority: pubkey,
  mints: z.array(pubkey),
  bump: z.number(),
});

export const PaymentStreamSchema = z.object({
  agentDid: z.array(z.number()).length(32),
  client: pubkey,
  payerMint: pubkey,
  payoutMint: pubkey,
  ratePerSec: bn,
  startTime: bn,
  maxDuration: bn,
  depositTotal: bn,
  withdrawn: bn,
  escrowBump: z.number(),
  status: z.record(z.unknown()),
  streamNonce: z.array(z.number()).length(8),
  bump: z.number(),
});

export const InitTreasuryArgsSchema = z.object({
  agentDid: z.array(z.number()).length(32),
  dailySpendLimit: bn,
  perTxLimit: bn,
  weeklyLimit: bn,
});

export const WithdrawArgsSchema = z.object({
  amount: bn,
});

export const InitStreamArgsSchema = z.object({
  streamNonce: z.array(z.number()).length(8),
  ratePerSec: bn,
  maxDuration: bn,
});

export const WithdrawEarnedArgsSchema = z.object({
  routeData: z.instanceof(Uint8Array),
});
