import Fastify from 'fastify';
import { z } from 'zod';
import { loadConfig, type Config } from './config.js';
import {
  hexToKey,
  sign,
  type AttestationPayload,
} from './attestation.js';
import {
  AkashProviderStub,
  IonetProviderStub,
  selectProvider,
  type ComputeProvider,
} from './providers.js';
import {
  attestationsSigned,
  bondRequests,
  leaseReservationLatency,
  registry,
} from './metrics.js';

const BondRequestBody = z.object({
  agent_did: z.string().min(32).max(44),
  provider: z.enum(['ionet', 'akash']),
  gpu_hours: z.number().int().positive(),
  duration_secs: z.number().int().positive(),
  capability_hints: z.array(z.string()).optional(),
});

const BondCancelBody = z.object({
  lease_id: z.string().min(1),
  agent_did: z.string().min(32).max(44),
  signed_request: z.string().min(1),
});

export type BuildOpts = {
  cfg: Config;
  providers?: { ionet: ComputeProvider; akash: ComputeProvider };
};

export function build(opts: BuildOpts) {
  const cfg = opts.cfg;
  const providers = opts.providers ?? {
    ionet: new IonetProviderStub(),
    akash: new AkashProviderStub(),
  };
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  app.get('/healthz', async () => ({
    status: 'ok',
    broker_key_loaded: cfg.signingKeyHex !== undefined,
    providers: ['ionet', 'akash'],
  }));

  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });

  app.get('/leases/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    try {
      const status = await providers.ionet.status(id);
      return { lease_id: id, status };
    } catch (err) {
      return reply.code(501).send({ error: asMessage(err) });
    }
  });

  app.post('/bonds/request', async (req, reply) => {
    const parsed = BondRequestBody.safeParse(req.body);
    if (!parsed.success) {
      bondRequests.inc({ provider: 'unknown', status: 'bad_request' });
      return reply.code(400).send({ error: parsed.error.message });
    }
    const body = parsed.data;

    if (body.duration_secs > cfg.maxBondDurationSecs) {
      bondRequests.inc({ provider: body.provider, status: 'duration_exceeded' });
      return reply.code(400).send({ error: 'duration exceeds maxBondDuration' });
    }

    if (cfg.signingKeyHex === undefined) {
      bondRequests.inc({ provider: body.provider, status: 'no_key' });
      return reply.code(503).send({ error: 'broker key not loaded' });
    }

    const provider = selectProvider(body.provider, providers);
    const stopTimer = leaseReservationLatency.startTimer({ provider: body.provider });

    let reservation;
    try {
      reservation = await provider.reserve({
        gpuHours: body.gpu_hours,
        durationSecs: body.duration_secs,
        capabilityHints: body.capability_hints,
      });
      stopTimer({ status: 'ok' });
    } catch (err) {
      stopTimer({ status: 'error' });
      bondRequests.inc({ provider: body.provider, status: 'provider_error' });
      return reply.code(502).send({ error: asMessage(err) });
    }

    const payload: AttestationPayload = {
      agent_did: body.agent_did,
      provider: body.provider,
      lease_id: reservation.leaseId,
      gpu_hours: reservation.gpuHours,
      expires_at: reservation.expiresAt,
    };

    let attestation;
    try {
      attestation = await sign(payload, hexToKey(cfg.signingKeyHex));
    } catch (err) {
      bondRequests.inc({ provider: body.provider, status: 'sign_error' });
      return reply.code(500).send({ error: asMessage(err) });
    }

    attestationsSigned.inc({ provider: body.provider });
    bondRequests.inc({ provider: body.provider, status: 'ok' });

    return reply.send({
      lease_id: reservation.leaseId,
      attestation_sig: attestation.signatureBs58,
      broker_pubkey: attestation.pubkeyBs58,
      gpu_hours: reservation.gpuHours,
      expires_at: reservation.expiresAt,
      reserved_price_usd_micro: reservation.pricedUsdMicro,
    });
  });

  app.post('/bonds/cancel', async (req, reply) => {
    const parsed = BondCancelBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return reply.code(501).send({
      error: 'NOT_YET_WIRED',
      reason: 'cancel path requires signed_request verify + provider refund call',
    });
  });

  return app;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
