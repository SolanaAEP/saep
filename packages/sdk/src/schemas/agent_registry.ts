import { z } from 'zod';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

const pubkey = z.instanceof(PublicKey);
const bn = z.instanceof(BN);

export const ReputationScoreSchema = z.object({
  quality: z.number(),
  timeliness: z.number(),
  availability: z.number(),
  costEfficiency: z.number(),
  honesty: z.number(),
  volume: z.number(),
  ewmaAlphaBps: z.number(),
  sampleCount: z.number(),
  lastUpdate: bn,
  _reserved: z.array(z.number()).length(24),
});

export const PendingSlashSchema = z.object({
  amount: bn,
  reasonCode: z.number(),
  proposedAt: bn,
  executableAt: bn,
  proposer: pubkey,
  appealPending: z.boolean(),
});

export const PendingWithdrawalSchema = z.object({
  amount: bn,
  requestedAt: bn,
  executableAt: bn,
});

export const AgentStatusSchema = z.enum(['active', 'paused', 'suspended', 'deregistered']);

export const AgentAccountSchema = z.object({
  operator: pubkey,
  agentId: z.array(z.number()).length(32),
  did: z.array(z.number()).length(32),
  manifestUri: z.array(z.number()).length(128),
  capabilityMask: bn,
  priceLamports: bn,
  streamRate: bn,
  reputation: ReputationScoreSchema,
  jobsCompleted: bn,
  jobsDisputed: z.number(),
  stakeAmount: bn,
  status: z.record(z.unknown()),
  version: z.number(),
  registeredAt: bn,
  lastActive: bn,
  delegate: pubkey.nullable(),
  pendingSlash: PendingSlashSchema.nullable(),
  pendingWithdrawal: PendingWithdrawalSchema.nullable(),
  bump: z.number(),
  vaultBump: z.number(),
});

export const RegistryGlobalSchema = z.object({
  authority: pubkey,
  pendingAuthority: pubkey.nullable(),
  capabilityRegistry: pubkey,
  taskMarket: pubkey,
  disputeArbitration: pubkey,
  slashingTreasury: pubkey,
  stakeMint: pubkey,
  minStake: bn,
  maxSlashBps: z.number(),
  slashTimelockSecs: bn,
  paused: z.boolean(),
  bump: z.number(),
});

export const RegisterAgentArgsSchema = z.object({
  agentId: z.array(z.number()).length(32),
  manifestUri: z.array(z.number()).length(128),
  capabilityMask: bn,
  priceLamports: bn,
  streamRate: bn,
  stakeAmount: bn,
});

export const UpdateManifestArgsSchema = z.object({
  manifestUri: z.array(z.number()).length(128),
  capabilityMask: bn,
  priceLamports: bn,
  streamRate: bn,
});

export const StakeIncreaseArgsSchema = z.object({
  amount: bn,
});

export const StakeWithdrawRequestArgsSchema = z.object({
  amount: bn,
});

export const JobOutcomeSchema = z.object({
  success: z.boolean(),
  qualityBps: z.number(),
  timelinessBps: z.number(),
  costEfficiencyBps: z.number(),
  disputed: z.boolean(),
});
