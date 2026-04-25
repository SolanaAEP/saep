import { z } from 'zod';
import { WEBHOOK_EVENT_TYPES } from './webhooks.js';

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

export const TaskIdParamsSchema = z.object({
  task_id: HexString.refine((s) => s.length === 64, '32-byte hex'),
});

export const TaskHistoryQuerySchema = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const TasksQuerySchema = z.object({
  capability: z.coerce.number().int().min(0).max(127).optional(),
  status: z.string().optional(),
  min_reward: z.string().regex(/^[0-9]+$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const ComputeBondQuerySchema = z.object({
  status: z.enum(['reserved', 'locked', 'released', 'slashed', 'cancelled', 'expired']).optional(),
  provider: z.enum(['ionet', 'akash']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const YieldStrategyQuerySchema = z.object({
  venue: z.enum(['kamino', 'marginfi', 'drift']).optional(),
  status: z.enum(['active', 'paused', 'revoked']).optional(),
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

export const WebhookEventTypeSchema = z.enum(WEBHOOK_EVENT_TYPES);

export const WebhookSubscriptionCreateSchema = z.object({
  url: z.string().url(),
  events: z.array(WebhookEventTypeSchema).min(1),
  secret: z.string().min(16).max(256),
  description: z.string().trim().min(1).max(120).optional(),
});

export const WebhookSubscriptionParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const WebhookSubscriptionRotateSecretSchema = z.object({
  secret: z.string().min(16).max(256),
});

export const WebhookDeliveriesQuerySchema = z.object({
  state: z.enum(['pending', 'delivered', 'retrying', 'dead_letter']).optional(),
  subscription_id: z.string().trim().min(1).optional(),
  event_id: z.string().trim().min(1).optional(),
  event_type: WebhookEventTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const IsoDateTimeString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'valid ISO datetime');

export const WebhookEventEmitSchema = z.object({
  type: WebhookEventTypeSchema,
  chain: z.string().trim().min(1).default('solana'),
  cluster: z.string().trim().min(1).default('devnet'),
  resource: z.object({
    type: z.enum(['task', 'bid', 'stream', 'agent']),
    id: z.string().trim().min(1),
  }),
  payload: z.record(z.unknown()).default({}),
});

export const WebhookReplayRequestSchema = z.object({
  event_id: z.string().trim().min(1).optional(),
  since: IsoDateTimeString.optional(),
  until: IsoDateTimeString.optional(),
  event_types: z.array(WebhookEventTypeSchema).min(1).optional(),
  subscription_ids: z.array(z.string().trim().min(1)).min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).refine(
  (value) => Boolean(value.event_id || value.since),
  'event_id or since is required',
);

export const WsMessageSchema = z.discriminatedUnion('type', [
  WsSubscribeSchema,
  WsUnsubscribeSchema,
]);

export type AgentsQuery = z.infer<typeof AgentsQuerySchema>;
export type AgentDidParams = z.infer<typeof AgentDidParamsSchema>;
export type TaskIdParams = z.infer<typeof TaskIdParamsSchema>;
export type TaskHistoryQuery = z.infer<typeof TaskHistoryQuerySchema>;
export type TasksQuery = z.infer<typeof TasksQuerySchema>;
export type ComputeBondQuery = z.infer<typeof ComputeBondQuerySchema>;
export type YieldStrategyQuery = z.infer<typeof YieldStrategyQuerySchema>;
export type WebhookSubscriptionCreate = z.infer<typeof WebhookSubscriptionCreateSchema>;
export type WebhookSubscriptionParams = z.infer<typeof WebhookSubscriptionParamsSchema>;
export type WebhookSubscriptionRotateSecret = z.infer<typeof WebhookSubscriptionRotateSecretSchema>;
export type WebhookDeliveriesQuery = z.infer<typeof WebhookDeliveriesQuerySchema>;
export type WebhookEventEmit = z.infer<typeof WebhookEventEmitSchema>;
export type WebhookReplayRequest = z.infer<typeof WebhookReplayRequestSchema>;
export type WsMessage = z.infer<typeof WsMessageSchema>;
