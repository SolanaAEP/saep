import { z } from 'zod';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

const pubkey = z.instanceof(PublicKey);
const bn = z.instanceof(BN);

export const RegistryConfigSchema = z.object({
  authority: pubkey,
  approvedMask: bn,
  tagCount: z.number(),
  pendingAuthority: pubkey.nullable(),
  paused: z.boolean(),
  bump: z.number(),
});

export const CapabilityTagSchema = z.object({
  bitIndex: z.number(),
  slug: z.array(z.number()).length(32),
  manifestUri: z.array(z.number()).length(96),
  addedAt: bn,
  addedBy: pubkey,
  retired: z.boolean(),
  bump: z.number(),
});

export const ProposeTagArgsSchema = z.object({
  bitIndex: z.number(),
  slug: z.array(z.number()).length(32),
  manifestUri: z.array(z.number()).length(96),
});

export const RetireTagArgsSchema = z.object({
  bitIndex: z.number(),
});

export const ValidateMaskArgsSchema = z.object({
  mask: bn,
});
