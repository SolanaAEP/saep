import { createHash, randomBytes, createCipheriv } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pino from 'pino';
import {
  ProveRequestSchema,
  JobIdParamsSchema,
  type PrivateInputs,
  type PublicInputs,
} from './schema.js';
import {
  buildQueue,
  redisConnection,
  keyKey,
  resultKey,
  cacheKey,
  type ProveJobData,
} from './queue.js';
import { registry, cacheHits } from './metrics.js';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'private_inputs',
      'witness_ciphertext',
      'witness_key',
      'aes_key',
    ],
    censor: '[redacted]',
  },
});

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const PORT = Number(process.env.PROOFGEN_PORT ?? 8787);
const ARTIFACTS_DIR = resolve(
  process.env.CIRCUIT_ARTIFACTS_DIR ?? '../../circuits/task_completion/build',
);
const KEY_TTL = Number(process.env.PROOFGEN_KEY_TTL_SEC ?? 600);

function artifactsReady(): boolean {
  // NO-ARTIFACTS-YET — circom build has not run; wasm + zkey must exist.
  if (!existsSync(ARTIFACTS_DIR)) return false;
  const files = readdirSync(ARTIFACTS_DIR);
  return files.some((f) => f.endsWith('.wasm')) && files.some((f) => f.endsWith('.zkey'));
}

function resolveAgent(authHeader: string | undefined): { agent_did: string } | null {
  // SIWS-AUTH-STUB — M1 accepts any bearer; returns a placeholder DID.
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;
  return { agent_did: 'agent:dev' };
}

function checkRateLimit(_agentDid: string): { ok: true } | { ok: false; retry_after: number } {
  // RATE-LIMIT-STUB — token bucket per agent_did, 10/min burst, 2/min sustained.
  return { ok: true };
}

function encryptWitness(priv: PrivateInputs): {
  ciphertext: string;
  iv: string;
  tag: string;
  key: Buffer;
} {
  // WITNESS-ENCRYPT-STUB — AES-256-GCM with ephemeral per-job key. Key is stored in Redis
  // with short TTL (see keyKey()) and deleted by the worker after decrypt.
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(priv), 'utf8');
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  plaintext.fill(0);
  return {
    ciphertext: ct.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    key,
  };
}

function hashPublicInputs(circuit_id: string, pub: PublicInputs): string {
  const canonical = JSON.stringify([
    circuit_id,
    pub.task_hash,
    pub.result_hash,
    pub.deadline,
    pub.submitted_at,
    pub.criteria_root,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

export async function buildServer() {
  const app = Fastify({ loggerInstance: logger });
  const connection = redisConnection(REDIS_URL);
  const queue = buildQueue(connection);

  app.get('/healthz', async () => {
    let redisStatus: 'up' | 'down' = 'down';
    try {
      const pong = await connection.ping();
      redisStatus = pong === 'PONG' ? 'up' : 'down';
    } catch {
      redisStatus = 'down';
    }
    const [waiting, active, failed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getFailedCount(),
    ]);
    const artifactFiles = artifactsReady() ? readdirSync(ARTIFACTS_DIR) : [];
    return {
      ok: redisStatus === 'up',
      redis: redisStatus,
      artifacts: artifactsReady() ? 'present' : 'missing',
      circuits_loaded: artifactFiles.filter((f) => f.endsWith('.wasm')).length,
      queue: { waiting, active, failed },
    };
  });

  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });

  app.post('/prove', async (req, reply) => {
    if (!artifactsReady()) {
      return reply.code(503).send({ error: 'no_artifacts' });
    }

    const agent = resolveAgent(req.headers.authorization);
    if (!agent) return reply.code(401).send({ error: 'unauthorized' });

    const rl = checkRateLimit(agent.agent_did);
    if (!rl.ok) return reply.code(429).send({ error: 'rate_limited', retry_after: rl.retry_after });

    const parsed = ProveRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const { circuit_id, public_inputs, private_inputs } = parsed.data;

    const pubHash = hashPublicInputs(circuit_id, public_inputs);

    const cached = await connection.get(cacheKey(pubHash));
    if (cached) {
      cacheHits.inc({ circuit: circuit_id });
      return reply.code(200).send({ status: 'completed', cached: true, ...JSON.parse(cached) });
    }

    const enc = encryptWitness(private_inputs);
    const jobId = randomUUID();
    await connection.set(keyKey(jobId), enc.key.toString('base64'), 'EX', KEY_TTL);
    enc.key.fill(0);

    const data: ProveJobData = {
      circuit_id,
      public_inputs: public_inputs as unknown as Record<string, string>,
      witness_ciphertext: enc.ciphertext,
      witness_iv: enc.iv,
      witness_tag: enc.tag,
      agent_did: agent.agent_did,
      public_inputs_hash: pubHash,
    };
    await queue.add('prove', data, { jobId });

    return reply.code(202).send({ job_id: jobId, status: 'queued' });
  });

  app.get('/jobs/:id', async (req, reply) => {
    const params = JobIdParamsSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });
    const { id } = params.data;

    const cached = await connection.get(resultKey(id));
    if (cached) {
      return reply.send(JSON.parse(cached));
    }

    const job = await queue.getJob(id);
    if (!job) return reply.code(404).send({ error: 'not_found' });

    const state = await job.getState();
    if (state === 'completed') {
      return reply.send({ status: 'completed', ...(job.returnvalue ?? {}) });
    }
    if (state === 'failed') {
      return reply.send({ status: 'failed', error: job.failedReason ?? 'unknown' });
    }
    return reply.send({ status: state });
  });

  const close = async () => {
    await app.close();
    await queue.close();
    connection.disconnect();
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  return { app, queue, connection };
}

async function main() {
  const { app } = await buildServer();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info({ port: PORT, artifacts_dir: ARTIFACTS_DIR }, 'proof-gen api up');
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  main().catch((err) => {
    logger.error({ err }, 'proof-gen api failed to start');
    process.exit(1);
  });
}
