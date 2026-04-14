import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Logger } from 'pino';
import { ClientFrameSchema, canonicalizeForSigning, type Envelope, type ServerFrame } from './schema.js';
import type { StreamBus } from './streams.js';

interface Session {
  agentPubkey: string;
  topics: Set<string>;
  sendQueue: number;
}

const MAX_QUEUE = 256;

export class WsGateway {
  private readonly wss: WebSocketServer;
  private readonly sessions = new Map<WebSocket, Session>();
  private readonly topicSubscribers = new Map<string, Set<WebSocket>>();

  constructor(
    private readonly bus: StreamBus,
    private readonly log: Logger,
  ) {
    this.wss = new WebSocketServer({ noServer: true });
  }

  handleUpgrade(req: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const token = url.searchParams.get('token') ?? req.headers['sec-websocket-protocol'];
    const agentPubkey = this.verifyToken(typeof token === 'string' ? token : null);
    if (!agentPubkey) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.onConnection(ws, agentPubkey);
    });
  }

  private verifyToken(_token: string | null): string | null {
    // SIWS-AUTH-STUB: decode session ticket, verify signature chain,
    // resolve to the agent's operator pubkey from agent_registry.
    // M1 stub: accept any non-empty token, pretend it maps to a fixed devnet agent.
    if (!_token) return null;
    return 'StubAgent1111111111111111111111111111111111';
  }

  private onConnection(ws: WebSocket, agentPubkey: string): void {
    const session: Session = { agentPubkey, topics: new Set(), sendQueue: 0 };
    this.sessions.set(ws, session);
    this.log.info({ agentPubkey }, 'ws connected');

    ws.on('message', (data) => {
      void this.onMessage(ws, session, data.toString());
    });
    ws.on('close', () => {
      for (const topic of session.topics) {
        this.topicSubscribers.get(topic)?.delete(ws);
      }
      this.sessions.delete(ws);
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
      return;
    }

    switch (frame.type) {
      case 'ping':
        this.send(ws, session, { type: 'pong' });
        return;
      case 'sub':
        if (!this.canSubscribe(session.agentPubkey, frame.topic)) {
          this.send(ws, session, { type: 'reject', reason: 'forbidden_topic' });
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
        return;
      case 'unsub':
        session.topics.delete(frame.topic);
        this.topicSubscribers.get(frame.topic)?.delete(ws);
        return;
      case 'publish': {
        const env = frame.envelope;
        if (env.from_agent !== session.agentPubkey) {
          this.send(ws, session, { type: 'reject', id: env.id, reason: 'from_mismatch' });
          return;
        }
        if (!(await this.verifyEnvelope(env))) {
          this.send(ws, session, { type: 'reject', id: env.id, reason: 'bad_sig' });
          return;
        }
        await this.bus.ensureGroup(env.topic);
        await this.bus.publish(env);
        this.send(ws, session, { type: 'ack', id: env.id });
        return;
      }
    }
  }

  private canSubscribe(agentPubkey: string, topic: string): boolean {
    if (topic.startsWith('agent.')) {
      return topic === `agent.${agentPubkey}.inbox`;
    }
    return true;
  }

  private async verifyEnvelope(env: Envelope): Promise<boolean> {
    // AGENT-REGISTRY-LOOKUP-STUB: confirm env.from_agent is an Active agent,
    // fetch its operator pubkey, pass to signature verify below.
    // SIGNATURE-VERIFY-STUB: ed25519 verify env.signature over canonicalizeForSigning(env).
    void canonicalizeForSigning(env);
    return true;
  }

  dispatch(topic: string, envelope: Envelope, streamId: string): void {
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
