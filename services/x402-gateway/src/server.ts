import Fastify from 'fastify';
import IORedis, { type Redis } from 'ioredis';
import { z } from 'zod';
import { loadConfig, type Config } from './config.js';
import { isTargetAllowed } from './allowlist.js';
import { canonicalizeProxy, verifyProxyRequest } from './auth.js';
import { checkRate } from './ratelimit.js';
import {
  facilitateVerifyTotal,
  proxyDuration,
  proxyRequests,
  registry,
} from './metrics.js';

const ProxyBody = z.object({
  target_url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  body_hash: z.string().optional(),
  budget_lamports: z.number().int().positive(),
  mint: z.string().min(32).max(44),
  nonce: z.string().min(1),
  agent_did: z.string().min(32).max(44),
  signature: z.string().min(64).max(128),
});

const FacilitateBody = z.object({
  x_payment: z.string().min(1),
  resource_ref: z.string().min(1),
});

export type BuildOpts = {
  cfg: Config;
  redis?: Redis;
};

export function build(opts: BuildOpts) {
  const cfg = opts.cfg;
  const redis = opts.redis ?? new IORedis(cfg.redisUrl);
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  app.get('/healthz', async () => ({
    status: 'ok',
    redis: redis.status,
    allow_pattern: cfg.allowPattern,
    allow_list: cfg.allowList,
  }));

  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });

  app.post('/proxy', async (req, reply) => {
    const end = proxyDuration.startTimer();
    const parsed = ProxyBody.safeParse(req.body);
    if (!parsed.success) {
      proxyRequests.inc({ status: 'bad_request' });
      end({ status: 'bad_request' });
      return reply.code(400).send({ error: parsed.error.message });
    }
    const body = parsed.data;

    if (body.budget_lamports > cfg.maxBudgetLamports) {
      proxyRequests.inc({ status: 'budget_exceeded' });
      end({ status: 'budget_exceeded' });
      return reply.code(400).send({ error: 'budget exceeds maxBudgetLamports' });
    }

    if (!isTargetAllowed(body.target_url, cfg.allowPattern, cfg.allowList)) {
      proxyRequests.inc({ status: 'forbidden_target' });
      end({ status: 'forbidden_target' });
      return reply.code(403).send({ error: 'target_url not in allow-config' });
    }

    const canonical = canonicalizeProxy({
      target_url: body.target_url,
      method: body.method,
      budget_lamports: body.budget_lamports,
      mint: body.mint,
      body_hash: body.body_hash,
      nonce: body.nonce,
    });
    const sigOk = await verifyProxyRequest(canonical, body.signature, body.agent_did);
    if (!sigOk) {
      proxyRequests.inc({ status: 'unauthorized' });
      end({ status: 'unauthorized' });
      return reply.code(401).send({ error: 'signature invalid' });
    }

    const rate = await checkRate(redis, body.agent_did, cfg.ratePerMin, cfg.ratePerDay);
    if (!rate.allowed) {
      proxyRequests.inc({ status: 'rate_limited' });
      end({ status: 'rate_limited' });
      return reply.code(429).send({ error: 'rate limit', ...rate });
    }

    proxyRequests.inc({ status: 'accepted' });
    end({ status: 'accepted' });
    return reply.code(501).send({
      error: 'NOT_YET_WIRED',
      reason:
        'proxy + 402 retry + task_market bundle settlement pending SDK program factories. tracked in backlog/P1_protocol_integrations_x402_mcp_sak.md.',
    });
  });

  app.post('/facilitate/verify', async (req, reply) => {
    const parsed = FacilitateBody.safeParse(req.body);
    if (!parsed.success) {
      facilitateVerifyTotal.inc({ result: 'bad_request' });
      return reply.code(400).send({ error: parsed.error.message });
    }
    facilitateVerifyTotal.inc({ result: 'not_wired' });
    return reply.code(501).send({
      error: 'NOT_YET_WIRED',
      reason:
        'X-PAYMENT verify + on-chain settlement lookup pending indexer schema v3 (settled_tx table).',
    });
  });

  app.addHook('onClose', async () => {
    if (redis.status !== 'end') await redis.quit();
  });

  return app;
}

export async function main(): Promise<void> {
  const cfg = loadConfig();
  const app = build({ cfg });
  await app.listen({ port: cfg.port, host: cfg.host });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
