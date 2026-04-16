import { z } from 'zod';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

const pubkey = z.instanceof(PublicKey);
const bn = z.instanceof(BN);

export const VerifierConfigSchema = z.object({
  authority: pubkey,
  pendingAuthority: pubkey.nullable(),
  activeVk: pubkey,
  pendingVk: pubkey.nullable(),
  pendingActivatesAt: bn,
  paused: z.boolean(),
  bump: z.number(),
});

export const VerifierKeySchema = z.object({
  vkId: z.array(z.number()).length(32),
  alphaG1: z.array(z.number()).length(64),
  betaG2: z.array(z.number()).length(128),
  gammaG2: z.array(z.number()).length(128),
  deltaG2: z.array(z.number()).length(128),
  ic: z.array(z.array(z.number()).length(64)),
  numPublicInputs: z.number(),
  circuitLabel: z.array(z.number()).length(32),
  isProduction: z.boolean(),
  registeredAt: bn,
  registeredBy: pubkey,
  bump: z.number(),
});

export const GlobalModeSchema = z.object({
  isMainnet: z.boolean(),
  bump: z.number(),
});

export const RegisterVkArgsSchema = z.object({
  vkId: z.array(z.number()).length(32),
  alphaG1: z.array(z.number()).length(64),
  betaG2: z.array(z.number()).length(128),
  gammaG2: z.array(z.number()).length(128),
  deltaG2: z.array(z.number()).length(128),
  ic: z.array(z.array(z.number()).length(64)),
  numPublicInputs: z.number(),
  circuitLabel: z.array(z.number()).length(32),
  isProduction: z.boolean(),
});

export const VerifyProofArgsSchema = z.object({
  proofA: z.array(z.number()).length(64),
  proofB: z.array(z.number()).length(128),
  proofC: z.array(z.number()).length(64),
  publicInputs: z.array(z.array(z.number()).length(32)),
});
