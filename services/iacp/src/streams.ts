import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Envelope } from './schema.js';

const FIELD = 'env';
const DEFAULT_MAXLEN = 50_000;

export interface StreamMessage {
  streamId: string;
  topic: string;
  envelope: Envelope;
}

export class StreamBus {
  constructor(
    private readonly redis: Redis,
    private readonly group: string,
    private readonly consumer: string,
    private readonly log: Logger,
  ) {}

  async ensureGroup(topic: string): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', topic, this.group, '$', 'MKSTREAM');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('BUSYGROUP')) throw err;
    }
  }

  async publish(envelope: Envelope, maxLen = DEFAULT_MAXLEN): Promise<string> {
    return this.redis.xadd(
      envelope.topic,
      'MAXLEN',
      '~',
      String(maxLen),
      '*',
      FIELD,
      JSON.stringify(envelope),
    ) as Promise<string>;
  }

  async read(topics: string[], blockMs = 5_000, count = 64): Promise<StreamMessage[]> {
    if (topics.length === 0) return [];
    const args: (string | number)[] = [
      'GROUP',
      this.group,
      this.consumer,
      'COUNT',
      String(count),
      'BLOCK',
      String(blockMs),
      'STREAMS',
      ...topics,
      ...topics.map(() => '>'),
    ];
    const raw = (await (this.redis.xreadgroup as (...a: (string | number)[]) => Promise<unknown>)(
      ...args,
    )) as Array<[string, Array<[string, string[]]>]> | null;
    if (!raw) return [];
    const out: StreamMessage[] = [];
    for (const [topic, entries] of raw) {
      for (const [streamId, kv] of entries) {
        const idx = kv.indexOf(FIELD);
        if (idx < 0 || idx + 1 >= kv.length) continue;
        try {
          const envelope = JSON.parse(kv[idx + 1]!) as Envelope;
          out.push({ streamId, topic, envelope });
        } catch (err) {
          this.log.warn({ err, streamId, topic }, 'stream entry parse failed');
        }
      }
    }
    return out;
  }

  async ack(topic: string, streamId: string): Promise<void> {
    await this.redis.xack(topic, this.group, streamId);
  }

  async trim(topic: string, maxLen: number): Promise<number> {
    return this.redis.xtrim(topic, 'MAXLEN', '~', maxLen);
  }
}
