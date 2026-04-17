import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import pino from 'pino';
import { getPool, query, queryOne, close as closeDb } from './db.js';
import {
  AgentsQuerySchema,
  AgentDidParamsSchema,
  TaskHistoryQuerySchema,
  WsMessageSchema,
  type WsMessage,
} from './schema.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'discovery' });
const PORT = Number(process.env.DISCOVERY_PORT ?? 8790);

function hexToBytes(hex: string): Buffer {
  return Buffer.from(hex, 'hex');
}

function bytesToHex(buf: Buffer): string {
  return buf.toString('hex');
}

type SortColumn = 'reputation_composite' | 'reward_lamports' | 'jobs_completed';

const SORT_MAP: Record<string, SortColumn> = {
  reputation: 'reputation_composite',
  price: 'reward_lamports',
  jobs_completed: 'jobs_completed',
};

async function buildServer() {
  const app = Fastify({ loggerInstance: log });
  await app.register(websocket);

  app.get('/healthz', async () => {
    try {
      await getPool().query('SELECT 1');
      return { status: 'ok' };
    } catch {
      return { status: 'degraded' };
    }
  });

  // GET /agents — paginated agent search
  app.get('/agents', async (req, reply) => {
    const parsed = AgentsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', issues: parsed.error.issues });
    }
    const q = parsed.data;
    const offset = (q.page - 1) * q.limit;
    const sortKey = q.sort ?? 'reputation';
    const sortCol: SortColumn = SORT_MAP[sortKey] ?? 'reputation_composite';

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (q.status) {
      conditions.push(`status = $${idx++}`);
      values.push(q.status);
    }
    if (q.capability != null) {
      conditions.push(`(capability_mask & $${idx}::numeric) = $${idx}::numeric`);
      values.push(q.capability.toString());
      idx++;
    }
    if (q.min_reputation !== undefined) {
      conditions.push(`reputation_composite >= $${idx++}`);
      values.push(q.min_reputation);
    }
    if (q.min_stake) {
      conditions.push(`stake_amount >= $${idx++}::numeric`);
      values.push(q.min_stake);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sortDir = sortCol === 'reputation_composite' ? 'DESC' : 'DESC';

    const countSql = `SELECT count(*)::int AS total FROM agent_directory ${where}`;
    const countRow = await queryOne<{ total: number }>(countSql, values);
    const total = countRow?.total ?? 0;

    const dataSql = `
      SELECT agent_did, operator,
             capability_mask::text AS capability_mask,
             stake_amount::text AS stake_amount,
             reputation_composite, status, last_active_unix
      FROM agent_directory ${where}
      ORDER BY ${sortCol} ${sortDir}, agent_did ASC
      LIMIT $${idx++} OFFSET $${idx++}`;
    const dataValues = [...values, q.limit, offset];

    const rows = await query<{
      agent_did: Buffer;
      operator: string | null;
      capability_mask: string | null;
      stake_amount: string | null;
      reputation_composite: number;
      status: string;
      last_active_unix: string;
    }>(dataSql, dataValues);

    return {
      items: rows.map((r) => ({
        did: bytesToHex(r.agent_did),
        operator: r.operator,
        capability_mask: r.capability_mask,
        stake_lamports: r.stake_amount,
        reputation: r.reputation_composite,
        status: r.status,
        last_active_unix: Number(r.last_active_unix),
      })),
      page: q.page,
      limit: q.limit,
      total,
    };
  });

  // GET /agents/:did — single agent detail with reputation breakdown
  app.get('/agents/:did', async (req, reply) => {
    const params = AgentDidParamsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_did' });
    }
    const didBytes = hexToBytes(params.data.did);

    const agent = await queryOne<{
      agent_did: Buffer;
      operator: string | null;
      capability_mask: string | null;
      stake_amount: string | null;
      reputation_composite: number;
      status: string;
      last_active_unix: string;
    }>(
      `SELECT agent_did, operator, capability_mask::text AS capability_mask,
              stake_amount::text AS stake_amount, reputation_composite,
              status, last_active_unix
       FROM agent_directory WHERE agent_did = $1`,
      [didBytes],
    );
    if (!agent) return reply.code(404).send({ error: 'agent_not_found' });

    const reputation = await query<{
      capability_bit: number;
      quality: number;
      timeliness: number;
      availability: number;
      cost_efficiency: number;
      honesty: number;
      jobs_completed: string;
      jobs_disputed: string;
      composite_score: number;
      last_update: Date;
    }>(
      `SELECT capability_bit, quality, timeliness, availability,
              cost_efficiency, honesty, jobs_completed, jobs_disputed,
              composite_score, last_update
       FROM reputation_rollup WHERE agent_did = $1
       ORDER BY capability_bit ASC`,
      [didBytes],
    );

    return {
      did: bytesToHex(agent.agent_did),
      operator: agent.operator,
      capability_mask: agent.capability_mask,
      stake_lamports: agent.stake_amount,
      reputation_composite: agent.reputation_composite,
      status: agent.status,
      last_active_unix: Number(agent.last_active_unix),
      reputation_breakdown: reputation.map((r) => ({
        capability_bit: r.capability_bit,
        quality: r.quality,
        timeliness: r.timeliness,
        availability: r.availability,
        cost_efficiency: r.cost_efficiency,
        honesty: r.honesty,
        jobs_completed: Number(r.jobs_completed),
        jobs_disputed: Number(r.jobs_disputed),
        composite_score: r.composite_score,
        last_update_unix: Math.floor(r.last_update.getTime() / 1000),
      })),
    };
  });

  // GET /agents/:did/tasks — task history for an agent
  app.get('/agents/:did/tasks', async (req, reply) => {
    const params = AgentDidParamsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_did' });
    }
    const qParsed = TaskHistoryQuerySchema.safeParse(req.query);
    if (!qParsed.success) {
      return reply.code(400).send({ error: 'invalid_query', issues: qParsed.error.issues });
    }
    const q = qParsed.data;
    const didBytes = hexToBytes(params.data.did);
    const offset = (q.page - 1) * q.limit;

    const conditions = ['agent_did = $1'];
    const values: unknown[] = [didBytes];
    let idx = 2;

    if (q.status) {
      const statuses = q.status.split(',').map((s) => s.trim());
      conditions.push(`status = ANY($${idx++})`);
      values.push(statuses);
    }

    const where = conditions.join(' AND ');

    const countRow = await queryOne<{ total: number }>(
      `SELECT count(*)::int AS total FROM task_directory WHERE ${where}`,
      values,
    );

    const rows = await query<{
      task_id: Buffer;
      creator: string | null;
      status: string | null;
      reward_lamports: string | null;
      created_at_unix: string;
      deadline_unix: string;
      updated_at_unix: string;
    }>(
      `SELECT task_id, creator, status,
              reward_lamports::text AS reward_lamports,
              created_at_unix, deadline_unix, updated_at_unix
       FROM task_directory WHERE ${where}
       ORDER BY created_at_unix DESC, task_id ASC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, q.limit, offset],
    );

    return {
      items: rows.map((r) => ({
        task_id: bytesToHex(r.task_id),
        creator: r.creator,
        status: r.status,
        reward_lamports: r.reward_lamports,
        created_at_unix: Number(r.created_at_unix),
        deadline_unix: Number(r.deadline_unix),
        updated_at_unix: Number(r.updated_at_unix),
      })),
      page: q.page,
      limit: q.limit,
      total: countRow?.total ?? 0,
    };
  });

  // GET /capabilities — all registered capability tags
  app.get('/capabilities', async () => {
    const rows = await query<{
      capability_bit: number;
      agents: number;
      tasks: number;
    }>(
      `SELECT capability_bit, count(DISTINCT agent_did)::int AS agents,
              sum(jobs_completed)::int AS tasks
       FROM reputation_rollup
       GROUP BY capability_bit
       ORDER BY capability_bit ASC`,
    );
    return { capabilities: rows };
  });

  // GET /stats — protocol-level stats
  app.get('/stats', async () => {
    const row = await queryOne<{
      total_agents: number;
      total_tasks: number;
      volume_lamports: string;
      active_streams: number;
      protocol_fees_lamports: string;
      last_24h_fees_lamports: string;
    }>(`
      SELECT
        (SELECT count(*)::int FROM agent_directory) AS total_agents,
        (SELECT count(*)::int FROM task_directory) AS total_tasks,
        COALESCE((SELECT sum((data->>'agent_payout')::numeric)
                    FROM program_events WHERE event_name='TaskReleased'), 0)::text
          AS volume_lamports,
        GREATEST(
          (SELECT count(*) FROM program_events WHERE event_name='StreamInitialized')
          - (SELECT count(*) FROM program_events WHERE event_name='StreamClosed'),
          0
        )::int AS active_streams,
        COALESCE((SELECT sum((data->>'protocol_fee')::numeric)
                    FROM program_events WHERE event_name='TaskReleased'), 0)::text
          AS protocol_fees_lamports,
        COALESCE((SELECT sum(CASE WHEN ingested_at >= now() - interval '24 hours'
                                  THEN (data->>'protocol_fee')::numeric ELSE 0 END)
                    FROM program_events WHERE event_name='TaskReleased'), 0)::text
          AS last_24h_fees_lamports
    `);

    return {
      total_agents: row?.total_agents ?? 0,
      total_tasks: row?.total_tasks ?? 0,
      total_value_locked_lamports: row?.volume_lamports ?? '0',
      active_streams: row?.active_streams ?? 0,
      burn_rate: {
        total_protocol_fees_lamports: row?.protocol_fees_lamports ?? '0',
        last_24h_lamports: row?.last_24h_fees_lamports ?? '0',
      },
    };
  });

  // WebSocket /ws — real-time subscriptions
  app.get('/ws', { websocket: true }, (socket) => {
    let capabilities: Set<number> | null = null;
    let events: Set<string> | null = null;

    socket.on('message', (raw: Buffer) => {
      let msg: WsMessage;
      try {
        const parsed = WsMessageSchema.safeParse(JSON.parse(raw.toString()));
        if (!parsed.success) {
          socket.send(JSON.stringify({ error: 'invalid_message', issues: parsed.error.issues }));
          return;
        }
        msg = parsed.data;
      } catch {
        socket.send(JSON.stringify({ error: 'invalid_json' }));
        return;
      }

      if (msg.type === 'subscribe') {
        capabilities = msg.capabilities ? new Set(msg.capabilities) : null;
        events = msg.events ? new Set(msg.events) : null;
        socket.send(JSON.stringify({ type: 'subscribed', capabilities: msg.capabilities, events: msg.events }));
      } else {
        capabilities = null;
        events = null;
        socket.send(JSON.stringify({ type: 'unsubscribed' }));
      }
    });

    // Poll for new events and push to subscribers.
    // In production this would consume from Redis Streams / pg LISTEN/NOTIFY.
    // For now, poll task_directory + agent_directory at intervals.
    let lastPoll = Date.now();
    const interval = setInterval(async () => {
      if (!capabilities && !events) return;
      const since = lastPoll;
      lastPoll = Date.now();
      const sinceUnix = Math.floor(since / 1000);

      try {
        if (!events || events.has('status_change')) {
          const changed = await query<{
            agent_did: Buffer;
            status: string;
            reputation_composite: number;
            last_active_unix: string;
          }>(
            `SELECT agent_did, status, reputation_composite, last_active_unix
             FROM agent_directory WHERE last_active_unix > $1
             ORDER BY last_active_unix DESC LIMIT 50`,
            [sinceUnix],
          );
          for (const row of changed) {
            if (capabilities && capabilities.size > 0) {
              // capability filtering requires checking the mask — skip for simplicity
              // in the polling approach; full filtering with Redis pub/sub in next cycle
            }
            socket.send(JSON.stringify({
              type: 'status_change',
              agent: {
                did: bytesToHex(row.agent_did),
                status: row.status,
                reputation: row.reputation_composite,
                last_active_unix: Number(row.last_active_unix),
              },
            }));
          }
        }

        if (!events || events.has('new_task')) {
          const tasks = await query<{
            task_id: Buffer;
            creator: string | null;
            status: string | null;
            reward_lamports: string | null;
            created_at_unix: string;
            deadline_unix: string;
          }>(
            `SELECT task_id, creator, status,
                    reward_lamports::text AS reward_lamports,
                    created_at_unix, deadline_unix
             FROM task_directory WHERE created_at_unix > $1
             ORDER BY created_at_unix DESC LIMIT 50`,
            [sinceUnix],
          );
          for (const row of tasks) {
            socket.send(JSON.stringify({
              type: 'new_task',
              task: {
                task_id: bytesToHex(row.task_id),
                creator: row.creator,
                status: row.status,
                reward_lamports: row.reward_lamports,
                created_at_unix: Number(row.created_at_unix),
                deadline_unix: Number(row.deadline_unix),
              },
            }));
          }
        }
      } catch (err) {
        log.error({ err: err instanceof Error ? err.message : String(err) }, 'ws poll error');
      }
    }, 5_000);

    socket.on('close', () => clearInterval(interval));
    socket.on('error', () => clearInterval(interval));
  });

  const shutdown = async () => {
    log.info('shutting down');
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  return app;
}

async function main() {
  const app = await buildServer();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  log.info({ port: PORT }, 'discovery api up');
}

main().catch((err) => {
  log.error({ err: err instanceof Error ? err.message : String(err) }, 'fatal');
  process.exit(1);
});
