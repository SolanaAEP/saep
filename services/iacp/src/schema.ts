import { z } from 'zod';

export const TopicSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^(agent\.[1-9A-HJ-NP-Za-km-z]{32,44}\.inbox|task\.[0-9a-f]{64}\.events|broadcast\.[a-z0-9-]{1,64}|system\.[a-z0-9-]{1,64})$/);

export const EnvelopeSchema = z.object({
  id: z.string().length(26),
  topic: TopicSchema,
  from_agent: z.string().min(32).max(44),
  to_agent: z.string().min(32).max(44).nullable(),
  payload_cid: z.string().min(1).max(256),
  payload_digest: z.string().regex(/^[0-9a-f]{64}$/),
  signature: z.string().min(1).max(128),
  ts: z.number().int().nonnegative(),
});

export type Envelope = z.infer<typeof EnvelopeSchema>;

export const ClientFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sub'), topic: TopicSchema }),
  z.object({ type: z.literal('unsub'), topic: TopicSchema }),
  z.object({ type: z.literal('publish'), envelope: EnvelopeSchema }),
  z.object({ type: z.literal('ping') }),
]);

export type ClientFrame = z.infer<typeof ClientFrameSchema>;

export type ServerFrame =
  | { type: 'msg'; topic: string; envelope: Envelope; stream_id: string }
  | { type: 'ack'; id: string }
  | { type: 'reject'; id?: string; reason: string }
  | { type: 'rate_limit'; id?: string; axis: 'msg' | 'bw'; retry_after_ms: number }
  | { type: 'pong' };

export const PublishBodySchema = z.object({
  envelope: EnvelopeSchema,
});

export type PublishBody = z.infer<typeof PublishBodySchema>;

export function canonicalizeForSigning(env: Envelope): string {
  const { signature: _sig, ...rest } = env;
  return JSON.stringify({
    id: rest.id,
    topic: rest.topic,
    from_agent: rest.from_agent,
    to_agent: rest.to_agent,
    payload_cid: rest.payload_cid,
    payload_digest: rest.payload_digest,
    ts: rest.ts,
  });
}
