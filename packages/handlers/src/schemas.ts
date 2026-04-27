import { z } from 'zod';

export const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export const Hex32 = z.string().regex(/^[0-9a-f]{64}$/i);
export const UintString = z.string().regex(/^\d+$/);

export const RegisterAgentSchema = z.object({
  capability_bits: z.array(z.number().int().min(0).max(127)).min(1),
  metadata_uri: z.string().url(),
  agent_id_seed: z.string().max(32).optional(),
  stake_amount: UintString.default('0'),
  stake_mint: Base58,
  operator_token_account: Base58,
  price_lamports: UintString.default('0'),
  stream_rate: UintString.default('0'),
});

export const ListTasksSchema = z.object({
  agent_did_hex: Hex32.optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const DiscoverTasksSchema = z.object({
  capability_bit: z.number().int().min(0).max(127).optional(),
  status: z.enum(['open', 'bidding', 'awarded', 'settled', 'disputed']).optional(),
  min_payment_usdc: z.number().nonnegative().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const GetTaskSchema = z.object({
  task_address: Base58,
});

export const GetReputationSchema = z.object({
  agent_did_hex: Hex32.optional(),
  capability_bit: z.number().int().min(0).max(127).optional(),
});

export const BidSchema = z.object({
  task_address: Base58,
  amount_usdc_micro: z.number().int().positive(),
  agent_did_hex: Hex32,
  bidder_token_account: Base58,
});

export const RevealBidSchema = z.object({
  task_address: Base58,
  amount_usdc_micro: z.number().int().positive(),
  nonce_hex: Hex32,
});

export const SubmitResultSchema = z.object({
  task_address: Base58,
  result_hash: Hex32,
  proof_key: Hex32,
});

export const ClaimPayoutSchema = z.object({
  task_address: Base58,
  agent_account_address: Base58.optional(),
  agent_token_account: Base58.optional(),
});

export const WithdrawEarningsSchema = z.object({
  stream_address: Base58,
  route_data_base64: z.string().optional(),
  jupiter_program: Base58.optional(),
  payer_price_feed: Base58.optional(),
  payout_price_feed: Base58.optional(),
});

export type RegisterAgentInput = z.infer<typeof RegisterAgentSchema>;
export type ListTasksInput = z.infer<typeof ListTasksSchema>;
export type DiscoverTasksInput = z.infer<typeof DiscoverTasksSchema>;
export type GetTaskInput = z.infer<typeof GetTaskSchema>;
export type GetReputationInput = z.infer<typeof GetReputationSchema>;
export type BidInput = z.infer<typeof BidSchema>;
export type RevealBidInput = z.infer<typeof RevealBidSchema>;
export type SubmitResultInput = z.infer<typeof SubmitResultSchema>;
export type ClaimPayoutInput = z.infer<typeof ClaimPayoutSchema>;
export type WithdrawEarningsInput = z.infer<typeof WithdrawEarningsSchema>;
