import type { Envelope } from './schema.js';

export interface RingEntry {
  envelope: Envelope;
  stream_id: string;
  received_at: number;
}

export class TopicRing {
  private readonly buffers = new Map<string, RingEntry[]>();

  constructor(private readonly capacity = 256) {}

  push(topic: string, envelope: Envelope, streamId: string): void {
    let buf = this.buffers.get(topic);
    if (!buf) {
      buf = [];
      this.buffers.set(topic, buf);
    }
    buf.push({ envelope, stream_id: streamId, received_at: Date.now() });
    if (buf.length > this.capacity) buf.splice(0, buf.length - this.capacity);
  }

  recent(topic: string, limit = 64): RingEntry[] {
    const buf = this.buffers.get(topic);
    if (!buf) return [];
    return buf.slice(-Math.max(1, Math.min(limit, this.capacity)));
  }

  topics(): string[] {
    return Array.from(this.buffers.keys());
  }
}
