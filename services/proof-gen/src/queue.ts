import { Queue, QueueEvents, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';

export const QUEUE_NAME = 'proof-gen';

export type ProveJobData = {
  circuit_id: string;
  public_inputs: Record<string, string>;
  witness_ciphertext: string;
  witness_iv: string;
  witness_tag: string;
  agent_did: string;
  public_inputs_hash: string;
};

export type ProveJobResult = {
  proof: unknown;
  public_signals: string[];
};

export function redisConnection(url: string): IORedis {
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}

export function buildQueue(connection: ConnectionOptions): Queue<ProveJobData, ProveJobResult> {
  return new Queue<ProveJobData, ProveJobResult>(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86_400 },
    },
  });
}

export function buildQueueEvents(connection: ConnectionOptions): QueueEvents {
  return new QueueEvents(QUEUE_NAME, { connection });
}

export function resultKey(jobId: string): string {
  return `proof-gen:result:${jobId}`;
}

export function keyKey(jobId: string): string {
  return `proof-gen:key:${jobId}`;
}

export function cacheKey(hash: string): string {
  return `proof-gen:cache:${hash}`;
}
