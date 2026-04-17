import { describe, expect, it } from 'vitest';
import {
  MessageType,
  TypedPayloadSchema,
  validatePayload,
  isExpired,
  shouldAnchor,
  isPartialAnchor,
  routingMode,
  broadcastChannel,
  MESSAGE_TYPE_META,
} from '../message_types.js';

const taskId = 'a'.repeat(64);

describe('TypedPayloadSchema', () => {
  it('accepts valid TaskRequest', () => {
    const r = TypedPayloadSchema.safeParse({
      msg_type: MessageType.TaskRequest,
      capability_bit: 5,
    });
    expect(r.success).toBe(true);
  });

  it('rejects TaskRequest without capability_bit', () => {
    const r = TypedPayloadSchema.safeParse({
      msg_type: MessageType.TaskRequest,
    });
    expect(r.success).toBe(false);
  });

  it('accepts valid TaskAccept', () => {
    const r = TypedPayloadSchema.safeParse({
      msg_type: MessageType.TaskAccept,
      task_id: taskId,
    });
    expect(r.success).toBe(true);
  });

  it('rejects TaskAccept without task_id', () => {
    const r = TypedPayloadSchema.safeParse({
      msg_type: MessageType.TaskAccept,
    });
    expect(r.success).toBe(false);
  });

  it('rejects TaskAccept with bad task_id format', () => {
    const r = TypedPayloadSchema.safeParse({
      msg_type: MessageType.TaskAccept,
      task_id: 'not-hex',
    });
    expect(r.success).toBe(false);
  });

  it('accepts valid TaskReject', () => {
    const r = TypedPayloadSchema.safeParse({
      msg_type: MessageType.TaskReject,
      task_id: taskId,
    });
    expect(r.success).toBe(true);
  });

  it('accepts TaskReject with optional reason', () => {
    const r = TypedPayloadSchema.safeParse({
      msg_type: MessageType.TaskReject,
      task_id: taskId,
      reason: 'too expensive',
    });
    expect(r.success).toBe(true);
  });

  it('accepts valid StatusUpdate', () => {
    const r = TypedPayloadSchema.safeParse({
      msg_type: MessageType.StatusUpdate,
      task_id: taskId,
      progress_pct: 42,
    });
    expect(r.success).toBe(true);
  });

  it('rejects StatusUpdate with progress > 100', () => {
    const r = TypedPayloadSchema.safeParse({
      msg_type: MessageType.StatusUpdate,
      task_id: taskId,
      progress_pct: 101,
    });
    expect(r.success).toBe(false);
  });

  it('accepts valid ResultDelivery', () => {
    const r = TypedPayloadSchema.safeParse({
      msg_type: MessageType.ResultDelivery,
      task_id: taskId,
      result_cid: 'bafyabc',
    });
    expect(r.success).toBe(true);
  });

  it('rejects ResultDelivery without result_cid', () => {
    const r = TypedPayloadSchema.safeParse({
      msg_type: MessageType.ResultDelivery,
      task_id: taskId,
    });
    expect(r.success).toBe(false);
  });

  it('accepts valid PaymentRequest', () => {
    const r = TypedPayloadSchema.safeParse({
      msg_type: MessageType.PaymentRequest,
      task_id: taskId,
      amount_lamports: 1_000_000,
    });
    expect(r.success).toBe(true);
  });

  it('rejects PaymentRequest with zero amount', () => {
    const r = TypedPayloadSchema.safeParse({
      msg_type: MessageType.PaymentRequest,
      task_id: taskId,
      amount_lamports: 0,
    });
    expect(r.success).toBe(false);
  });

  it('accepts valid BroadcastRFP', () => {
    const r = TypedPayloadSchema.safeParse({
      msg_type: MessageType.BroadcastRFP,
      capability_bit: 12,
    });
    expect(r.success).toBe(true);
  });

  it('rejects BroadcastRFP without capability_bit', () => {
    const r = TypedPayloadSchema.safeParse({
      msg_type: MessageType.BroadcastRFP,
    });
    expect(r.success).toBe(false);
  });

  it('accepts valid Dispute', () => {
    const r = TypedPayloadSchema.safeParse({
      msg_type: MessageType.Dispute,
      task_id: taskId,
      evidence_cid: 'bafyevidence',
    });
    expect(r.success).toBe(true);
  });

  it('accepts valid A2AOrchestration', () => {
    const r = TypedPayloadSchema.safeParse({
      msg_type: MessageType.A2AOrchestration,
      task_id: taskId,
      task_ttl_ms: 60_000,
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown msg_type', () => {
    const r = TypedPayloadSchema.safeParse({
      msg_type: 'unknown_type',
    });
    expect(r.success).toBe(false);
  });
});

describe('validatePayload', () => {
  it('returns ok for valid payload', () => {
    const result = validatePayload({
      msg_type: MessageType.TaskRequest,
      capability_bit: 3,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.msg_type).toBe(MessageType.TaskRequest);
    }
  });

  it('returns error for invalid payload', () => {
    const result = validatePayload({ msg_type: MessageType.TaskAccept });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeTruthy();
    }
  });
});

describe('isExpired', () => {
  it('TaskRequest expires after 5 minutes', () => {
    const sent = 1000;
    expect(isExpired(MessageType.TaskRequest, sent, sent + 4 * 60 * 1000)).toBe(false);
    expect(isExpired(MessageType.TaskRequest, sent, sent + 5 * 60 * 1000 + 1)).toBe(true);
  });

  it('StatusUpdate expires after 30 seconds', () => {
    const sent = 1000;
    expect(isExpired(MessageType.StatusUpdate, sent, sent + 29_000)).toBe(false);
    expect(isExpired(MessageType.StatusUpdate, sent, sent + 30_001)).toBe(true);
  });

  it('BroadcastRFP expires after 15 minutes', () => {
    const sent = 1000;
    expect(isExpired(MessageType.BroadcastRFP, sent, sent + 14 * 60 * 1000)).toBe(false);
    expect(isExpired(MessageType.BroadcastRFP, sent, sent + 15 * 60 * 1000 + 1)).toBe(true);
  });

  it('TaskReject expires after 5 minutes', () => {
    const sent = 1000;
    expect(isExpired(MessageType.TaskReject, sent, sent + 5 * 60 * 1000 + 1)).toBe(true);
  });

  it('permanent messages never expire', () => {
    const sent = 0;
    const farFuture = 999_999_999_999;
    expect(isExpired(MessageType.TaskAccept, sent, farFuture)).toBe(false);
    expect(isExpired(MessageType.ResultDelivery, sent, farFuture)).toBe(false);
    expect(isExpired(MessageType.PaymentRequest, sent, farFuture)).toBe(false);
    expect(isExpired(MessageType.Dispute, sent, farFuture)).toBe(false);
  });

  it('A2AOrchestration uses per-task TTL when provided', () => {
    const sent = 1000;
    const customTtl = 60_000;
    expect(isExpired(MessageType.A2AOrchestration, sent, sent + 59_000, customTtl)).toBe(false);
    expect(isExpired(MessageType.A2AOrchestration, sent, sent + 60_001, customTtl)).toBe(true);
  });

  it('A2AOrchestration without task_ttl_ms is permanent', () => {
    const sent = 0;
    expect(isExpired(MessageType.A2AOrchestration, sent, 999_999_999_999)).toBe(false);
  });
});

describe('shouldAnchor', () => {
  it('TaskAccept requires anchoring', () => {
    expect(shouldAnchor(MessageType.TaskAccept)).toBe(true);
  });
  it('ResultDelivery requires anchoring', () => {
    expect(shouldAnchor(MessageType.ResultDelivery)).toBe(true);
  });
  it('PaymentRequest requires anchoring', () => {
    expect(shouldAnchor(MessageType.PaymentRequest)).toBe(true);
  });
  it('Dispute requires anchoring', () => {
    expect(shouldAnchor(MessageType.Dispute)).toBe(true);
  });
  it('TaskRequest does not require anchoring', () => {
    expect(shouldAnchor(MessageType.TaskRequest)).toBe(false);
  });
  it('StatusUpdate does not require anchoring', () => {
    expect(shouldAnchor(MessageType.StatusUpdate)).toBe(false);
  });
  it('BroadcastRFP does not require anchoring', () => {
    expect(shouldAnchor(MessageType.BroadcastRFP)).toBe(false);
  });
});

describe('isPartialAnchor', () => {
  it('A2AOrchestration uses partial anchoring', () => {
    expect(isPartialAnchor(MessageType.A2AOrchestration)).toBe(true);
  });
  it('TaskAccept is fully anchored, not partial', () => {
    expect(isPartialAnchor(MessageType.TaskAccept)).toBe(false);
  });
});

describe('routingMode', () => {
  it('BroadcastRFP uses pubsub', () => {
    expect(routingMode(MessageType.BroadcastRFP)).toBe('pubsub');
  });
  it('all direct types route direct', () => {
    const directTypes = [
      MessageType.TaskRequest,
      MessageType.TaskAccept,
      MessageType.TaskReject,
      MessageType.StatusUpdate,
      MessageType.ResultDelivery,
      MessageType.PaymentRequest,
      MessageType.Dispute,
      MessageType.A2AOrchestration,
    ];
    for (const t of directTypes) {
      expect(routingMode(t)).toBe('direct');
    }
  });
});

describe('broadcastChannel', () => {
  it('generates channel from capability bit', () => {
    expect(broadcastChannel(5)).toBe('broadcast.cap-5');
    expect(broadcastChannel(0)).toBe('broadcast.cap-0');
    expect(broadcastChannel(127)).toBe('broadcast.cap-127');
  });
});

describe('MESSAGE_TYPE_META completeness', () => {
  it('has metadata for every MessageType variant', () => {
    for (const key of Object.values(MessageType)) {
      expect(MESSAGE_TYPE_META[key]).toBeDefined();
    }
  });
});
