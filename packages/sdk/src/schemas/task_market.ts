import { z } from 'zod';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

const pubkey = z.instanceof(PublicKey);
const bn = z.instanceof(BN);
const fixedBytes = (length: number) => z.array(z.number()).length(length);

export const PersonhoodTierSchema = z.union([
  z.object({ none: z.object({}).passthrough() }),
  z.object({ basic: z.object({}).passthrough() }),
  z.object({ verified: z.object({}).passthrough() }),
]);

export const TaskKindSchema = z.union([
  z.object({
    swapExact: z.object({
      inMint: pubkey,
      outMint: pubkey,
      amountIn: bn,
      minOut: bn,
    }),
  }),
  z.object({
    transfer: z.object({
      mint: pubkey,
      to: pubkey,
      amount: bn,
    }),
  }),
  z.object({
    dataFetch: z.object({
      urlHash: fixedBytes(32),
      expectedHash: fixedBytes(32),
    }),
  }),
  z.object({
    compute: z.object({
      circuitId: fixedBytes(32),
      publicInputsHash: fixedBytes(32),
    }),
  }),
  z.object({
    generic: z.object({
      capabilityBit: z.number(),
      argsHash: fixedBytes(32),
    }),
  }),
]);

export const TaskPayloadSchema = z.object({
  kind: TaskKindSchema,
  capabilityBit: z.number(),
  criteria: z.array(z.number()),
  requiresPersonhood: PersonhoodTierSchema,
});

export const TaskStatusSchema = z.enum([
  'created', 'funded', 'inExecution', 'proofSubmitted',
  'verified', 'released', 'expired', 'disputed', 'resolved',
]);

export const MarketGlobalSchema = z.object({
  authority: pubkey,
  pendingAuthority: pubkey.nullable(),
  agentRegistry: pubkey,
  treasuryStandard: pubkey,
  proofVerifier: pubkey,
  feeCollector: pubkey,
  solrepPool: pubkey,
  protocolFeeBps: z.number(),
  solrepFeeBps: z.number(),
  disputeWindowSecs: bn,
  maxDeadlineSecs: bn,
  allowedPaymentMints: z.array(pubkey).length(8),
  paused: z.boolean(),
  bump: z.number(),
});

export const TaskContractSchema = z.object({
  taskId: z.array(z.number()).length(32),
  client: pubkey,
  agentDid: z.array(z.number()).length(32),
  taskNonce: z.array(z.number()).length(8),
  paymentMint: pubkey,
  paymentAmount: bn,
  protocolFee: bn,
  solrepFee: bn,
  taskHash: z.array(z.number()).length(32),
  resultHash: z.array(z.number()).length(32),
  proofKey: z.array(z.number()).length(32),
  criteriaRoot: z.array(z.number()).length(32),
  milestoneCount: z.number(),
  milestonesComplete: z.number(),
  status: z.record(z.unknown()),
  createdAt: bn,
  fundedAt: bn,
  deadline: bn,
  submittedAt: bn,
  disputeWindowEnd: bn,
  verified: z.boolean(),
  bump: z.number(),
  escrowBump: z.number(),
});

export const CreateTaskArgsSchema = z.object({
  taskNonce: z.array(z.number()).length(8),
  agentDid: z.array(z.number()).length(32),
  paymentMint: pubkey,
  paymentAmount: bn,
  payload: TaskPayloadSchema,
  criteriaRoot: z.array(z.number()).length(32),
  deadline: bn,
  milestoneCount: z.number(),
});

export const SubmitResultArgsSchema = z.object({
  resultHash: z.array(z.number()).length(32),
  proofKey: z.array(z.number()).length(32),
});

export const VerifyTaskArgsSchema = z.object({
  proofA: z.array(z.number()).length(64),
  proofB: z.array(z.number()).length(128),
  proofC: z.array(z.number()).length(64),
});
