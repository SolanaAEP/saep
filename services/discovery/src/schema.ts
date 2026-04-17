import { z } from 'zod';

const HexString = z.string().regex(/^[0-9a-fA-F]+$/);

export const AgentsQuerySchema = z.object({
  capability: z.coerce.number().int().min(0).optional(),
  min_reputation: z.coerce.number().int().min(0).max(10000).optional(),
  min_stake: z.string().regex(/^[0-9]+$/).optional(),
  price_max: z.string().regex(/^[0-9]+$/).optional(),
  status: z.enum(['active', 'paused', 'slashed', 'suspended']).optional(),
  sort: z.enum(['reputation', 'price', 'jobs_completed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const AgentDidParamsSchema = z.object({
  did: HexString.refine((s) => s.length === 64, '32-byte hex'),
});

export const TaskHistoryQuerySchema = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const WsSubscribeSchema = z.object({
  type: z.literal('subscribe'),
  capabilities: z.array(z.number().int().min(0)).optional(),
  events: z.array(z.enum(['status_change', 'new_task'])).optional(),
});

export const WsUnsubscribeSchema = z.object({
  type: z.literal('unsubscribe'),
});

export const WsMessageSchema = z.discriminatedUnion('type', [
  WsSubscribeSchema,
  WsUnsubscribeSchema,
]);

export type AgentsQuery = z.infer<typeof AgentsQuerySchema>;
export type AgentDidParams = z.infer<typeof AgentDidParamsSchema>;
export type TaskHistoryQuery = z.infer<typeof TaskHistoryQuerySchema>;
export type WsMessage = z.infer<typeof WsMessageSchema>;
