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
import {
  finalizeManagedSettlement,
  parseXPaymentHeader,
  requestHash,
  settleViaTaskMarket,
  verifySettlement,
  type PaymentDetails,
  type PaymentReceipt,
  type UpstreamResponseSnapshot,
} from './settlement.js';

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
  settlement?: {
    settleViaTaskMarket?: (
      payment: PaymentDetails,
      requesterDid: string,
      argsHash: string,
      budgetLamports: number,
    ) => Promise<PaymentReceipt>;
    finalizeManagedSettlement?: (
      receipt: PaymentReceipt,
      upstream: UpstreamResponseSnapshot,
    ) => Promise<PaymentReceipt>;
    verifySettlement?: (
      receipt: Pick<PaymentReceipt, 'tx_sig' | 'task' | 'task_id_hex'>,
    ) => Promise<{
      status: 'confirmed' | 'finalized' | 'not_found' | 'failed';
      slot?: number;
      err?: string;
      task?: string;
      task_id_hex?: string;
      task_status?: string;
    }>;
  };
};

export function build(opts: BuildOpts) {
  const cfg = opts.cfg;
  const redis = opts.redis ?? new IORedis(cfg.redisUrl);
  const settlement = {
    settleViaTaskMarket: opts.settlement?.settleViaTaskMarket ??
      ((payment: PaymentDetails, requesterDid: string, argsHash: string, budgetLamports: number) =>
        settleViaTaskMarket(cfg, payment, requesterDid, argsHash, budgetLamports)),
    finalizeManagedSettlement: opts.settlement?.finalizeManagedSettlement ??
      ((receipt: PaymentReceipt, upstream: UpstreamResponseSnapshot) =>
        finalizeManagedSettlement(cfg, receipt, upstream)),
    verifySettlement: opts.settlement?.verifySettlement ??
      ((receipt: Pick<PaymentReceipt, 'tx_sig' | 'task' | 'task_id_hex'>) =>
        verifySettlement(cfg, receipt)),
  };
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (allowedOrigins.length > 0) {
    app.addHook('onSend', async (req, reply) => {
      const origin = req.headers.origin;
      if (origin && allowedOrigins.includes(origin)) {
        reply.header('access-control-allow-origin', origin);
        reply.header('access-control-allow-methods', 'GET, POST, OPTIONS');
        reply.header('access-control-allow-headers', 'content-type, x-payment');
      }
    });
    app.options('/*', async (_req, reply) => {
      reply.code(204).send();
    });
  }

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });

  app.get('/demo/paid', async (req, reply) => {
    if (!cfg.demoPaymentMint || !cfg.demoRecipientDid) {
      return reply.code(503).send({
        error: 'demo_not_configured',
        detail: 'set X402_DEMO_PAYMENT_MINT and X402_DEMO_RECIPIENT_DID to enable /demo/paid',
      });
    }

    const challenge = {
      scheme: 'exact',
      amount: Number(cfg.demoPaymentAmount),
      mint: cfg.demoPaymentMint,
      recipient: cfg.demoRecipientDid,
      resource: cfg.demoResource,
    };

    const requirePayment = (detail: string, txSig?: string) => reply
      .code(402)
      .header('cache-control', 'no-store')
      .header('x-payment', JSON.stringify(challenge))
      .send({
        error: 'payment_required',
        detail,
        resource: cfg.demoResource,
        tx_sig: txSig ?? null,
      });

    const xPayment = req.headers['x-payment'];
    if (typeof xPayment !== 'string') {
      return requirePayment('missing_x_payment_header');
    }

    let txSig: string;
    let taskAddress: string | null = null;
    let taskIdHex: string | null = null;
    let taskStatus: string | null = null;
    try {
      const payload = JSON.parse(xPayment) as {
        tx_sig?: string;
        task?: string;
        task_id_hex?: string;
        task_status?: string;
      };
      if (!payload.tx_sig) {
        return requirePayment('x_payment_missing_tx_sig');
      }
      txSig = payload.tx_sig;
      taskAddress = payload.task ?? null;
      taskIdHex = payload.task_id_hex ?? null;
      taskStatus = payload.task_status ?? null;
    } catch {
      return requirePayment('x_payment_invalid_json');
    }

    const verification = await settlement.verifySettlement({
      tx_sig: txSig,
      task: taskAddress ?? undefined,
      task_id_hex: taskIdHex ?? undefined,
    });
    if (verification.status === 'confirmed' || verification.status === 'finalized') {
      return reply.send({
        ok: true,
        resource: cfg.demoResource,
        settled_tx_sig: txSig,
        amount: challenge.amount,
        mint: challenge.mint,
        task: verification.task ?? taskAddress,
        task_id_hex: verification.task_id_hex ?? taskIdHex,
        task_status: verification.task_status ?? taskStatus,
        slot: verification.slot,
        message: 'paid access granted',
      });
    }

    if (verification.status === 'failed') {
      return requirePayment(`transaction_failed:${verification.err ?? 'unknown'}`, txSig);
    }

    return requirePayment(`transaction_not_found:${verification.err ?? 'pending'}`, txSig);
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

    const paymentReceipts: PaymentReceipt[] = [];
    let latestReceipt: PaymentReceipt | null = null;
    let attempt = 0;
    let lastUpstreamStatus = 0;
    let lastUpstreamBody = '';
    let lastUpstreamHeaders: Record<string, string> = {};

    while (attempt <= cfg.max402Retries) {
      attempt++;
      let upstream: Response;
      try {
        const headers = new Headers(body.headers ?? {});
        if (latestReceipt) {
          headers.set('x-payment', JSON.stringify(latestReceipt));
        }
        upstream = await fetch(body.target_url, {
          method: body.method,
          headers,
          body: body.method !== 'GET' ? body.body : undefined,
          signal: AbortSignal.timeout(cfg.proxyTimeoutMs),
          redirect: 'error',
        });
      } catch (e) {
        proxyRequests.inc({ status: 'upstream_error' });
        end({ status: 'upstream_error' });
        console.error('[x402-gateway] upstream fetch failed:', e);
        return reply.code(502).send({
          error: 'upstream_error',
          detail: 'upstream_unavailable',
        });
      }

      lastUpstreamStatus = upstream.status;
      lastUpstreamBody = await upstream.text();
      lastUpstreamHeaders = Object.fromEntries(upstream.headers.entries());

      if (upstream.status !== 402) break;

      const xPayment = upstream.headers.get('x-payment');
      if (!xPayment) break;

      const payment = parseXPaymentHeader(xPayment);
      if (!payment) break;

      const argsHash = requestHash(body.method, body.target_url, body.body);
      try {
        const receipt = await settlement.settleViaTaskMarket(
          payment,
          body.agent_did,
          argsHash,
          body.budget_lamports,
        );
        paymentReceipts.push(receipt);
        latestReceipt = receipt;
      } catch (e) {
        proxyRequests.inc({ status: 'settlement_failed' });
        end({ status: 'settlement_failed' });
        console.error('[x402-gateway] settlement failed:', e);
        return reply.code(402).send({
          error: 'settlement_failed',
          detail: 'settlement_rejected',
        });
      }
    }

    if (latestReceipt && lastUpstreamStatus >= 200 && lastUpstreamStatus < 300) {
      try {
        const finalized = await settlement.finalizeManagedSettlement(latestReceipt, {
          status: lastUpstreamStatus,
          headers: lastUpstreamHeaders,
          body: lastUpstreamBody,
        });
        paymentReceipts[paymentReceipts.length - 1] = finalized;
        latestReceipt = finalized;
      } catch (e) {
        proxyRequests.inc({ status: 'settlement_failed' });
        end({ status: 'settlement_failed' });
        console.error('[x402-gateway] settlement finalization failed:', e);
        return reply.code(502).send({
          error: 'settlement_finalization_failed',
          detail: e instanceof Error ? e.message : String(e),
          payment_receipts: paymentReceipts,
        });
      }
    }

    if (lastUpstreamStatus === 402) {
      proxyRequests.inc({ status: 'upstream_402' });
      end({ status: 'upstream_402' });
      return reply.code(402).send({
        error: 'upstream returned 402 after retry',
        status: lastUpstreamStatus,
        body: lastUpstreamBody,
        payment_receipts: paymentReceipts,
      });
    }

    proxyRequests.inc({ status: 'ok' });
    end({ status: 'ok' });
    return reply.code(lastUpstreamStatus || 502).send({
      status: lastUpstreamStatus,
      headers: lastUpstreamHeaders,
      body: lastUpstreamBody,
      payment_receipts: paymentReceipts,
    });
  });

  app.post('/facilitate/verify', async (req, reply) => {
    const parsed = FacilitateBody.safeParse(req.body);
    if (!parsed.success) {
      facilitateVerifyTotal.inc({ result: 'bad_request' });
      return reply.code(400).send({ error: parsed.error.message });
    }

    const { x_payment } = parsed.data;
    let txSig: string;
    let taskAddress: string | null = null;
    let taskIdHex: string | null = null;
    let taskStatus: string | null = null;
    try {
      const payload = JSON.parse(x_payment) as {
        tx_sig?: string;
        task?: string;
        task_id_hex?: string;
        task_status?: string;
      };
      if (!payload.tx_sig) {
        facilitateVerifyTotal.inc({ result: 'invalid_payload' });
        return reply.code(400).send({ error: 'x_payment missing tx_sig' });
      }
      txSig = payload.tx_sig;
      taskAddress = payload.task ?? null;
      taskIdHex = payload.task_id_hex ?? null;
      taskStatus = payload.task_status ?? null;
    } catch {
      facilitateVerifyTotal.inc({ result: 'invalid_payload' });
      return reply.code(400).send({ error: 'x_payment is not valid JSON' });
    }

    const result = await settlement.verifySettlement({
      tx_sig: txSig,
      task: taskAddress ?? undefined,
      task_id_hex: taskIdHex ?? undefined,
    });

    if (result.status === 'confirmed' || result.status === 'finalized') {
      facilitateVerifyTotal.inc({ result: 'settled' });
      return reply.send({
        ok: true,
        settled_tx_sig: txSig,
        task: result.task ?? taskAddress,
        task_id_hex: result.task_id_hex ?? taskIdHex,
        task_status: result.task_status ?? taskStatus,
        slot: result.slot,
      });
    }

    if (result.status === 'failed') {
      facilitateVerifyTotal.inc({ result: 'failed' });
      return reply.code(409).send({ ok: false, error: 'transaction failed', detail: result.err });
    }

    facilitateVerifyTotal.inc({ result: 'not_found' });
    return reply.code(404).send({ ok: false, error: 'transaction not found', detail: result.err });
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
