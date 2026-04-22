import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import pino from 'pino';
import { getPool, query, queryOne, close as closeDb } from './db.js';
import {
  type ComputeBondSummary,
  listPersistedComputeBonds,
  loadComputeBondMapForTaskIds,
} from './compute-bonds.js';
import {
  AgentsQuerySchema,
  AgentDidParamsSchema,
  ComputeBondQuerySchema,
  TaskIdParamsSchema,
  TaskHistoryQuerySchema,
  TasksQuerySchema,
  WebhookSubscriptionCreateSchema,
  WebhookDeliveriesQuerySchema,
  WebhookEventEmitSchema,
  WebhookReplayRequestSchema,
  WsMessageSchema,
  type WsMessage,
} from './schema.js';
import { JsonFileWebhookStore } from './webhook-store.js';
import { WebhookHub, authorizeToken } from './webhooks.js';

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

export interface BuildServerOptions {
  installSignalHandlers?: boolean;
  webhookHub?: WebhookHub;
  webhookAdminToken?: string;
  webhookServiceToken?: string;
  webhookStorePath?: string;
  db?: DiscoveryDb;
}

export interface DiscoveryDb {
  getPool: typeof getPool;
  query: typeof query;
  queryOne: typeof queryOne;
  close: typeof closeDb;
}

function requireToken(
  header: string | string[] | undefined,
  expected: string | undefined,
): boolean {
  const token = Array.isArray(header) ? header[0] : header;
  return authorizeToken(token, expected);
}

async function loadComputeBondsForTaskIds(
  db: DiscoveryDb,
  taskIds: readonly string[],
): Promise<Map<string, ComputeBondSummary[]>> {
  if (taskIds.length === 0) {
    return new Map();
  }
  return loadComputeBondMapForTaskIds(db.query, taskIds);
}

export async function buildServer(opts: BuildServerOptions = {}) {
  const app = Fastify({ loggerInstance: log });
  const db = opts.db ?? {
    getPool,
    query,
    queryOne,
    close: closeDb,
  };
  const webhookStorePath = opts.webhookStorePath ?? process.env.WEBHOOK_STORE_PATH;
  const webhookStore = webhookStorePath ? new JsonFileWebhookStore(webhookStorePath) : null;
  const webhookHub = opts.webhookHub ?? new WebhookHub({
    retryBaseMs: Number(process.env.WEBHOOK_RETRY_BASE_MS ?? 1_000),
    maxAttempts: Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? 4),
    initialState: webhookStore?.load(),
    persist: webhookStore ? (snapshot) => webhookStore.save(snapshot) : undefined,
  });
  const webhookAdminToken = opts.webhookAdminToken ?? process.env.WEBHOOK_ADMIN_TOKEN;
  const webhookServiceToken = opts.webhookServiceToken ?? process.env.WEBHOOK_SERVICE_TOKEN;
  await app.register(websocket);

  app.get('/healthz', async () => {
    try {
      await db.getPool().query('SELECT 1');
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
    const countRow = await db.queryOne<{ total: number }>(countSql, values);
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

    const rows = await db.query<{
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

  // GET /tasks — paginated task search backed by discovery views
  app.get('/tasks', async (req, reply) => {
    const parsed = TasksQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', issues: parsed.error.issues });
    }

    const q = parsed.data;
    const offset = (q.page - 1) * q.limit;
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (q.status) {
      const statuses = q.status.split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length > 0) {
        conditions.push(`t.status = ANY($${idx++})`);
        values.push(statuses);
      }
    }

    if (q.capability != null) {
      const mask = (1n << BigInt(q.capability)).toString();
      conditions.push(`(a.capability_mask & $${idx}::numeric) = $${idx}::numeric`);
      values.push(mask);
      idx++;
    }

    if (q.min_reward) {
      conditions.push(`t.reward_lamports >= $${idx++}::numeric`);
      values.push(q.min_reward);
    }

    const from = `
      FROM task_directory t
      LEFT JOIN agent_directory a ON a.agent_did = t.agent_did
    `;
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = await db.queryOne<{ total: number }>(
      `SELECT count(*)::int AS total ${from} ${where}`,
      values,
    );

    const rows = await db.query<{
      task_id: Buffer;
      creator: string | null;
      agent_did: Buffer | null;
      status: string | null;
      reward_lamports: string | null;
      capability_mask: string | null;
      created_at_unix: string;
      deadline_unix: string | null;
      updated_at_unix: string | null;
    }>(
      `SELECT t.task_id,
              t.creator,
              t.agent_did,
              t.status,
              t.reward_lamports::text AS reward_lamports,
              COALESCE(t.capability_mask::text, a.capability_mask::text) AS capability_mask,
              t.created_at_unix,
              t.deadline_unix,
              t.updated_at_unix
       ${from}
       ${where}
       ORDER BY t.created_at_unix DESC, t.task_id ASC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, q.limit, offset],
    );

    const items = rows.map((row) => ({
      task_id_hex: bytesToHex(row.task_id),
      creator: row.creator,
      agent_did_hex: row.agent_did ? bytesToHex(row.agent_did) : null,
      status: row.status,
      reward_lamports: row.reward_lamports,
      capability_mask: row.capability_mask,
      created_at_unix: Number(row.created_at_unix),
      deadline_unix: row.deadline_unix ? Number(row.deadline_unix) : null,
      updated_at_unix: row.updated_at_unix ? Number(row.updated_at_unix) : null,
      compute_bonds: [] as ComputeBondSummary[],
    }));
    const bondsByTaskId = await loadComputeBondsForTaskIds(
      db,
      items.map((item) => item.task_id_hex),
    );

    return {
      items: items.map((item) => ({
        ...item,
        compute_bonds: bondsByTaskId.get(item.task_id_hex) ?? [],
      })),
      page: q.page,
      limit: q.limit,
      total: countRow?.total ?? 0,
    };
  });

  // GET /agents/:did — single agent detail with reputation breakdown
  app.get('/agents/:did', async (req, reply) => {
    const params = AgentDidParamsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_did' });
    }
    const didBytes = hexToBytes(params.data.did);

    const agent = await db.queryOne<{
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

    const reputation = await db.query<{
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

    const countRow = await db.queryOne<{ total: number }>(
      `SELECT count(*)::int AS total FROM task_directory WHERE ${where}`,
      values,
    );

    const rows = await db.query<{
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

    const items = rows.map((r) => ({
      task_id: bytesToHex(r.task_id),
      creator: r.creator,
      status: r.status,
      reward_lamports: r.reward_lamports,
      created_at_unix: Number(r.created_at_unix),
      deadline_unix: Number(r.deadline_unix),
      updated_at_unix: Number(r.updated_at_unix),
      compute_bonds: [] as ComputeBondSummary[],
    }));
    const bondsByTaskId = await loadComputeBondsForTaskIds(
      db,
      items.map((item) => item.task_id),
    );

    return {
      items: items.map((item) => ({
        ...item,
        compute_bonds: bondsByTaskId.get(item.task_id) ?? [],
      })),
      page: q.page,
      limit: q.limit,
      total: countRow?.total ?? 0,
    };
  });

  app.get('/agents/:did/compute-bonds', async (req, reply) => {
    const params = AgentDidParamsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_did' });
    }
    const qParsed = ComputeBondQuerySchema.safeParse(req.query);
    if (!qParsed.success) {
      return reply.code(400).send({ error: 'invalid_query', issues: qParsed.error.issues });
    }

    const didBytes = hexToBytes(params.data.did);
    const taskRows = await db.query<{ task_id: Buffer }>(
      `SELECT task_id
       FROM task_directory
       WHERE agent_did = $1
       ORDER BY COALESCE(updated_at_unix, created_at_unix) DESC, task_id ASC
       LIMIT 200`,
      [didBytes],
    );
    const taskIds = taskRows.map((row) => bytesToHex(row.task_id));
    if (taskIds.length === 0) {
      return {
        agent_did: params.data.did,
        items: [],
      };
    }

    const items = await listPersistedComputeBonds(db.query, {
      taskIds,
      status: qParsed.data.status,
      provider: qParsed.data.provider,
      limit: qParsed.data.limit,
    });

    return {
      agent_did: params.data.did,
      items,
    };
  });

  app.get('/tasks/:task_id/compute-bonds', async (req, reply) => {
    const params = TaskIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_task_id' });
    }
    const qParsed = ComputeBondQuerySchema.safeParse(req.query);
    if (!qParsed.success) {
      return reply.code(400).send({ error: 'invalid_query', issues: qParsed.error.issues });
    }

    const items = await listPersistedComputeBonds(db.query, {
      taskId: params.data.task_id,
      status: qParsed.data.status,
      provider: qParsed.data.provider,
      limit: qParsed.data.limit,
    });

    return {
      task_id: params.data.task_id,
      items,
    };
  });

  // GET /capabilities — all registered capability tags
  app.get('/capabilities', async () => {
    const rows = await db.query<{
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
    const row = await db.queryOne<{
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

  app.post('/webhooks/subscriptions', async (req, reply) => {
    if (!requireToken(req.headers['x-saep-admin-token'], webhookAdminToken)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const parsed = WebhookSubscriptionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }

    const subscription = webhookHub.createSubscription(parsed.data);
    return reply.code(201).send(subscription);
  });

  app.get('/webhooks/subscriptions', async (req, reply) => {
    if (!requireToken(req.headers['x-saep-admin-token'], webhookAdminToken)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    return { items: webhookHub.listSubscriptions() };
  });

  app.get('/webhooks/deliveries', async (req, reply) => {
    if (!requireToken(req.headers['x-saep-admin-token'], webhookAdminToken)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const parsed = WebhookDeliveriesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', issues: parsed.error.issues });
    }

    return { items: webhookHub.listDeliveries(parsed.data.state) };
  });

  app.post('/webhooks/events', async (req, reply) => {
    if (!requireToken(req.headers['x-saep-service-token'], webhookServiceToken)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const parsed = WebhookEventEmitSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }

    const emitted = await webhookHub.emit(parsed.data);
    return reply.code(202).send({
      event: emitted.event,
      delivery_count: emitted.deliveries.length,
      deliveries: emitted.deliveries,
    });
  });

  app.post('/webhooks/replay', async (req, reply) => {
    if (!requireToken(req.headers['x-saep-admin-token'], webhookAdminToken)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const parsed = WebhookReplayRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }

    const replayed = await webhookHub.replay(parsed.data);
    return reply.code(202).send({
      event_count: replayed.events.length,
      delivery_count: replayed.deliveries.length,
      events: replayed.events,
      deliveries: replayed.deliveries,
    });
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
          const changed = await db.query<{
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
          const tasks = await db.query<{
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

  if (opts.installSignalHandlers !== false) {
    const shutdown = async () => {
      log.info('shutting down');
      await app.close();
      await db.close();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  }

  return app;
}

async function main() {
  const app = await buildServer();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  log.info({ port: PORT }, 'discovery api up');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'fatal');
    process.exit(1);
  });
}
