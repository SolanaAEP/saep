import { createDecipheriv } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Worker } from 'bullmq';
import pino from 'pino';
import * as snarkjs from 'snarkjs';
import {
  QUEUE_NAME,
  redisConnection,
  keyKey,
  resultKey,
  type ProveJobData,
  type ProveJobResult,
} from './queue.js';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: ['witness_ciphertext', 'witness_key', 'private_inputs'],
    censor: '[redacted]',
  },
});

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const ARTIFACTS_DIR = resolve(
  process.env.CIRCUIT_ARTIFACTS_DIR ?? '../../circuits/task_completion/build',
);
const CONCURRENCY = Number(process.env.PROOFGEN_WORKER_CONCURRENCY ?? 1);
const RESULT_TTL = Number(process.env.PROOFGEN_RESULT_TTL_SEC ?? 3600);

type CircuitArtifacts = { wasm: string; zkey: string };

function loadArtifacts(circuit_id: string): CircuitArtifacts {
  // CIRCUIT-ARTIFACT-LOAD-STUB — hardcoded resolver for task_completion.v1.
  if (circuit_id !== 'task_completion.v1') {
    throw new Error(`unknown circuit: ${circuit_id}`);
  }
  if (!existsSync(ARTIFACTS_DIR)) {
    throw new Error(`artifacts dir missing: ${ARTIFACTS_DIR}`);
  }
  const files = readdirSync(ARTIFACTS_DIR);
  const wasm = files.find((f) => f.endsWith('.wasm'));
  const zkey = files.find((f) => f.endsWith('.zkey'));
  if (!wasm || !zkey) throw new Error('wasm or zkey missing');
  return { wasm: join(ARTIFACTS_DIR, wasm), zkey: join(ARTIFACTS_DIR, zkey) };
}

function decryptWitness(data: ProveJobData, key: Buffer): Record<string, unknown> {
  const iv = Buffer.from(data.witness_iv, 'base64');
  const tag = Buffer.from(data.witness_tag, 'base64');
  const ct = Buffer.from(data.witness_ciphertext, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  try {
    return JSON.parse(plaintext.toString('utf8'));
  } finally {
    plaintext.fill(0);
  }
}

export function startWorker() {
  const connection = redisConnection(REDIS_URL);

  const worker = new Worker<ProveJobData, ProveJobResult>(
    QUEUE_NAME,
    async (job) => {
      const { circuit_id, public_inputs, agent_did, public_inputs_hash } = job.data;
      const log = logger.child({ job_id: job.id, agent_did, circuit_id });
      log.info('prove:start');

      const artifacts = loadArtifacts(circuit_id);

      const keyB64 = await connection.get(keyKey(job.id!));
      if (!keyB64) throw new Error('witness_key_expired');
      const key = Buffer.from(keyB64, 'base64');
      await connection.del(keyKey(job.id!));

      let witness: Record<string, unknown>;
      try {
        const priv = decryptWitness(job.data, key);
        witness = { ...public_inputs, ...priv };
      } finally {
        key.fill(0);
      }

      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        witness,
        artifacts.wasm,
        artifacts.zkey,
      );

      const result: ProveJobResult = { proof, public_signals: publicSignals as string[] };

      await connection.set(
        resultKey(job.id!),
        JSON.stringify({ status: 'completed', ...result }),
        'EX',
        RESULT_TTL,
      );
      // PROOF-CACHE-STUB — also SET cacheKey(public_inputs_hash) with same TTL for cross-agent reuse.
      log.info({ public_inputs_hash }, 'prove:done');
      return result;
    },
    { connection, concurrency: CONCURRENCY },
  );

  worker.on('failed', (job, err) => {
    logger.warn({ job_id: job?.id, err: err.message }, 'prove:failed');
  });

  const close = async () => {
    await worker.close();
    connection.disconnect();
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  return worker;
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  startWorker();
  logger.info({ artifacts_dir: ARTIFACTS_DIR, concurrency: CONCURRENCY }, 'proof-gen worker up');
}
