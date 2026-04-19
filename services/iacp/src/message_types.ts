import { z } from 'zod';

export enum MessageType {
  TaskRequest = 'task_request',
  TaskAccept = 'task_accept',
  TaskReject = 'task_reject',
  StatusUpdate = 'status_update',
  ResultDelivery = 'result_delivery',
  PaymentRequest = 'payment_request',
  BroadcastRFP = 'broadcast_rfp',
  Dispute = 'dispute',
  A2AOrchestration = 'a2a_orchestration',
}

export const MessageTypeSchema = z.nativeEnum(MessageType);

export type RoutingMode = 'direct' | 'pubsub';

export interface MessageTypeMeta {
  ttlMs: number | null; // null = permanent
  routing: RoutingMode;
  requiresAnchoring: boolean;
  partialAnchoring: boolean; // true = only result anchored
}

const FIVE_MIN = 5 * 60 * 1000;
const THIRTY_SEC = 30 * 1000;
const FIFTEEN_MIN = 15 * 60 * 1000;

export const MESSAGE_TYPE_META: Record<MessageType, MessageTypeMeta> = {
  [MessageType.TaskRequest]: {
    ttlMs: FIVE_MIN,
    routing: 'direct',
    requiresAnchoring: false,
    partialAnchoring: false,
  },
  [MessageType.TaskAccept]: {
    ttlMs: null,
    routing: 'direct',
    requiresAnchoring: true,
    partialAnchoring: false,
  },
  [MessageType.TaskReject]: {
    ttlMs: FIVE_MIN,
    routing: 'direct',
    requiresAnchoring: false,
    partialAnchoring: false,
  },
  [MessageType.StatusUpdate]: {
    ttlMs: THIRTY_SEC,
    routing: 'direct',
    requiresAnchoring: false,
    partialAnchoring: false,
  },
  [MessageType.ResultDelivery]: {
    ttlMs: null,
    routing: 'direct',
    requiresAnchoring: true,
    partialAnchoring: false,
  },
  [MessageType.PaymentRequest]: {
    ttlMs: null,
    routing: 'direct',
    requiresAnchoring: true,
    partialAnchoring: false,
  },
  [MessageType.BroadcastRFP]: {
    ttlMs: FIFTEEN_MIN,
    routing: 'pubsub',
    requiresAnchoring: false,
    partialAnchoring: false,
  },
  [MessageType.Dispute]: {
    ttlMs: null,
    routing: 'direct',
    requiresAnchoring: true,
    partialAnchoring: false,
  },
  [MessageType.A2AOrchestration]: {
    ttlMs: null, // per-task, set via task_ttl_ms field
    routing: 'direct',
    requiresAnchoring: false,
    partialAnchoring: true,
  },
};

const taskIdHex = z.string().regex(/^[0-9a-f]{64}$/);
const capabilityBit = z.number().int().min(0).max(127);

const TaskRequestPayload = z.object({
  msg_type: z.literal(MessageType.TaskRequest),
  capability_bit: capabilityBit,
  max_budget_lamports: z.number().int().nonnegative().optional(),
});

const TaskAcceptPayload = z.object({
  msg_type: z.literal(MessageType.TaskAccept),
  task_id: taskIdHex,
});

const TaskRejectPayload = z.object({
  msg_type: z.literal(MessageType.TaskReject),
  task_id: taskIdHex,
  reason: z.string().max(256).optional(),
});

const StatusUpdatePayload = z.object({
  msg_type: z.literal(MessageType.StatusUpdate),
  task_id: taskIdHex,
  progress_pct: z.number().min(0).max(100).optional(),
  message: z.string().max(1024).optional(),
});

const ResultDeliveryPayload = z.object({
  msg_type: z.literal(MessageType.ResultDelivery),
  task_id: taskIdHex,
  result_cid: z.string().min(1).max(256),
});

const PaymentRequestPayload = z.object({
  msg_type: z.literal(MessageType.PaymentRequest),
  task_id: taskIdHex,
  amount_lamports: z.number().int().positive(),
});

const BroadcastRFPPayload = z.object({
  msg_type: z.literal(MessageType.BroadcastRFP),
  capability_bit: capabilityBit,
  description_cid: z.string().min(1).max(256).optional(),
});

const DisputePayload = z.object({
  msg_type: z.literal(MessageType.Dispute),
  task_id: taskIdHex,
  evidence_cid: z.string().min(1).max(256),
});

const A2AOrchestrationPayload = z.object({
  msg_type: z.literal(MessageType.A2AOrchestration),
  task_id: taskIdHex,
  sub_task_id: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  task_ttl_ms: z.number().int().positive().max(86_400_000).optional(),
});

export const TypedPayloadSchema = z.discriminatedUnion('msg_type', [
  TaskRequestPayload,
  TaskAcceptPayload,
  TaskRejectPayload,
  StatusUpdatePayload,
  ResultDeliveryPayload,
  PaymentRequestPayload,
  BroadcastRFPPayload,
  DisputePayload,
  A2AOrchestrationPayload,
]);

export type TypedPayload = z.infer<typeof TypedPayloadSchema>;

export function validatePayload(data: unknown): { ok: true; payload: TypedPayload } | { ok: false; error: string } {
  const result = TypedPayloadSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, error: result.error.issues[0]?.message ?? 'invalid payload' };
  }
  return { ok: true, payload: result.data };
}

export function isExpired(msgType: MessageType, sentTs: number, now: number = Date.now(), taskTtlMs?: number): boolean {
  const meta = MESSAGE_TYPE_META[msgType];
  let ttl = meta.ttlMs;

  if (msgType === MessageType.A2AOrchestration && taskTtlMs != null) {
    ttl = taskTtlMs;
  }

  if (ttl === null) return false;
  return now - sentTs > ttl;
}

export function shouldAnchor(msgType: MessageType): boolean {
  return MESSAGE_TYPE_META[msgType].requiresAnchoring;
}

export function isPartialAnchor(msgType: MessageType): boolean {
  return MESSAGE_TYPE_META[msgType].partialAnchoring;
}

export function routingMode(msgType: MessageType): RoutingMode {
  return MESSAGE_TYPE_META[msgType].routing;
}

export function broadcastChannel(capabilityBit: number): string {
  return `broadcast.cap-${capabilityBit}`;
}
