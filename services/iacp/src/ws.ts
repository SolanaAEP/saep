import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Logger } from 'pino';
import bs58 from 'bs58';
import { ClientFrameSchema, canonicalizeForSigning, type Envelope, type ServerFrame } from './schema.js';
import type { StreamBus } from './streams.js';
import {
  verifySessionToken,
  verifyEnvelopeSignature,
  isEnvelopeTsFresh,
  type FreshnessOptions,
} from './auth.js';
import type { TopicRing } from './ring.js';
import type { AgentLookup } from './agents.js';
import type { AnchorWorkerPool } from './anchor.js';
import {
  buildBandwidthLimiter,
  buildMsgLimiter,
  defaultLimiterConfig,
  type KeyedRateLimiter,
  type LimiterConfig,
} from './rate_limit.js';
import {
  rateLimiterBucketCount,
  recordPublish,
  recordRateLimited,
  recordRejection,
  topicCategory,
  wsConnections,
  topicSubscribers,
} from './metrics.js';

interface Session {
  agentPubkey: string;
  socketId: string;
  topics: Set<string>;
  sendQueue: number;
}

const MAX_QUEUE = 256;

let socketCounter = 0;

export interface WsGatewayOptions {
  freshness?: FreshnessOptions;
  limits?: LimiterConfig;
  msgLimiter?: KeyedRateLimiter;
  bwLimiter?: KeyedRateLimiter;
  anchor?: AnchorWorkerPool | null;
}

export class WsGateway {
  private readonly wss: WebSocketServer;
  private readonly sessions = new Map<WebSocket, Session>();
  readonly topicSubscribers = new Map<string, Set<WebSocket>>();
  private readonly msgLimiter: KeyedRateLimiter;
  private readonly bwLimiter: KeyedRateLimiter;
  private readonly freshness: FreshnessOptions;
  private readonly anchor: AnchorWorkerPool | null;

  constructor(
    private readonly bus: StreamBus,
    private readonly log: Logger,
    private readonly ring: TopicRing,
    private readonly sessionSecret: Uint8Array,
    private readonly agents: AgentLookup | null = null,
    options: WsGatewayOptions = {},
  ) {
    this.wss = new WebSocketServer({ noServer: true });
    this.freshness = options.freshness ?? {};
    const cfg = options.limits ?? defaultLimiterConfig;
    this.msgLimiter = options.msgLimiter ?? buildMsgLimiter(cfg);
    this.bwLimiter = options.bwLimiter ?? buildBandwidthLimiter(cfg);
    this.anchor = options.anchor ?? null;
  }

  async handleUpgrade(
    req: IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const token = url.searchParams.get('token') ?? req.headers['sec-websocket-protocol'];
    const rawToken = typeof token === 'string' ? token : null;
    if (!rawToken) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const result = await verifySessionToken(rawToken, this.sessionSecret);
    if (!result) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.onConnection(ws, result.agentPubkey);
    });
  }

  sessionCount(): number {
    return this.sessions.size;
  }

  limiterSizes(): { msg: number; bw: number } {
    return { msg: this.msgLimiter.size(), bw: this.bwLimiter.size() };
  }

  sweepLimiters(now: number = Date.now()): void {
    this.msgLimiter.sweep(now);
    this.bwLimiter.sweep(now);
    rateLimiterBucketCount.set({ scope: 'msg' }, this.msgLimiter.size());
    rateLimiterBucketCount.set({ scope: 'bw' }, this.bwLimiter.size());
  }

  private onConnection(ws: WebSocket, agentPubkey: string): void {
    const socketId = `s${++socketCounter}`;
    const session: Session = { agentPubkey, socketId, topics: new Set(), sendQueue: 0 };
    this.sessions.set(ws, session);
    wsConnections.set(this.sessions.size);
    this.log.info({ agentPubkey, socketId }, 'ws connected');

    ws.on('message', (data) => {
      const raw = data.toString();
      void this.onMessage(ws, session, raw);
    });
    ws.on('close', () => {
      for (const topic of session.topics) {
        const subs = this.topicSubscribers.get(topic);
        if (subs) {
          subs.delete(ws);
          topicSubscribers.set({ topic: topicCategory(topic) }, subs.size);
        }
      }
      this.sessions.delete(ws);
      this.bwLimiter.delete(session.socketId);
      wsConnections.set(this.sessions.size);
    });
    ws.on('error', (err) => {
      this.log.warn({ err: err.message, agentPubkey }, 'ws error');
    });
  }

  private async onMessage(ws: WebSocket, session: Session, raw: string): Promise<void> {
    let frame;
    try {
      frame = ClientFrameSchema.parse(JSON.parse(raw));
    } catch {
      this.send(ws, session, { type: 'reject', reason: 'bad_frame' });
      recordRejection('ws', 'bad_frame');
      return;
    }

    switch (frame.type) {
      case 'ping':
        this.send(ws, session, { type: 'pong' });
        return;
      case 'sub':
        if (!this.canSubscribe(session.agentPubkey, frame.topic)) {
          this.send(ws, session, { type: 'reject', reason: 'forbidden_topic' });
          recordRejection('ws', 'forbidden_topic');
          return;
        }
        session.topics.add(frame.topic);
        let subs = this.topicSubscribers.get(frame.topic);
        if (!subs) {
          subs = new Set();
          this.topicSubscribers.set(frame.topic, subs);
          await this.bus.ensureGroup(frame.topic);
        }
        subs.add(ws);
        topicSubscribers.set({ topic: topicCategory(frame.topic) }, subs.size);
        return;
      case 'unsub': {
        session.topics.delete(frame.topic);
        const unsubs = this.topicSubscribers.get(frame.topic);
        if (unsubs) {
          unsubs.delete(ws);
          topicSubscribers.set({ topic: topicCategory(frame.topic) }, unsubs.size);
        }
        return;
      }
      case 'publish': {
        const env = frame.envelope;
        if (env.from_agent !== session.agentPubkey) {
          this.send(ws, session, { type: 'reject', id: env.id, reason: 'from_mismatch' });
          recordRejection('ws', 'from_mismatch');
          recordPublish('ws', env.topic, 'rejected');
          return;
        }
        const byteLen = Buffer.byteLength(raw, 'utf8');
        const bwCheck = this.bwLimiter.consume(session.socketId, byteLen);
        if (!bwCheck.allowed) {
          this.send(ws, session, {
            type: 'rate_limit',
            id: env.id,
            axis: 'bw',
            retry_after_ms: bwCheck.retryAfterMs,
          });
          recordRateLimited('ws', 'bw');
          recordPublish('ws', env.topic, 'rate_limited');
          return;
        }
        const msgCheck = this.msgLimiter.consume(session.agentPubkey);
        if (!msgCheck.allowed) {
          this.send(ws, session, {
            type: 'rate_limit',
            id: env.id,
            axis: 'msg',
            retry_after_ms: msgCheck.retryAfterMs,
          });
          recordRateLimited('ws', 'msg');
          recordPublish('ws', env.topic, 'rate_limited');
          return;
        }
        const verdict = await this.verifyEnvelope(env);
        if (verdict !== 'ok') {
          this.send(ws, session, { type: 'reject', id: env.id, reason: verdict });
          recordRejection('ws', verdict);
          recordPublish('ws', env.topic, 'rejected');
          return;
        }
        const start = performance.now();
        await this.bus.ensureGroup(env.topic);
        await this.bus.publish(env);
        this.anchor?.enqueue(env);
        this.send(ws, session, { type: 'ack', id: env.id });
        recordPublish('ws', env.topic, 'ok', (performance.now() - start) / 1000);
        return;
      }
    }
  }

  private canSubscribe(agentPubkey: string, topic: string): boolean {
    if (topic.startsWith('agent.')) {
      if (topic !== `agent.${agentPubkey}.inbox`) return false;
      // Regex accepts base58 strings of valid char class + length but doesn't
      // guarantee a 32-byte decode. Verify the pubkey segment is exactly 32 bytes.
      try {
        if (bs58.decode(agentPubkey).length !== 32) return false;
      } catch {
        return false;
      }
      return true;
    }
    return true;
  }

  private async verifyEnvelope(env: Envelope): Promise<'ok' | 'bad_sig' | 'stale_ts' | 'not_active'> {
    if (!isEnvelopeTsFresh(env.ts, Date.now(), this.freshness)) {
      return 'stale_ts';
    }
    const canonical = canonicalizeForSigning(env);
    if (!(await verifyEnvelopeSignature(canonical, env.signature, env.from_agent))) {
      return 'bad_sig';
    }
    if (this.agents && !(await this.agents.isActiveOperator(env.from_agent))) {
      return 'not_active';
    }
    return 'ok';
  }

  dispatch(topic: string, envelope: Envelope, streamId: string): void {
    this.ring.push(topic, envelope, streamId);
    const subs = this.topicSubscribers.get(topic);
    if (!subs || subs.size === 0) return;
    const frame: ServerFrame = { type: 'msg', topic, envelope, stream_id: streamId };
    const payload = JSON.stringify(frame);
    for (const ws of subs) {
      const session = this.sessions.get(ws);
      if (!session) continue;
      if (session.sendQueue >= MAX_QUEUE) {
        this.log.warn({ agent: session.agentPubkey, topic }, 'backpressure drop');
        ws.close(1009, 'slow_consumer');
        continue;
      }
      session.sendQueue++;
      ws.send(payload, (err) => {
        session.sendQueue--;
        if (err) this.log.warn({ err: err.message }, 'ws send failed');
      });
    }
  }

  private send(ws: WebSocket, session: Session, frame: ServerFrame): void {
    if (session.sendQueue >= MAX_QUEUE) {
      ws.close(1009, 'slow_consumer');
      return;
    }
    session.sendQueue++;
    ws.send(JSON.stringify(frame), () => {
      session.sendQueue--;
    });
  }
}
