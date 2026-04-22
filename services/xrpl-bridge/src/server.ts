import Fastify from 'fastify';
import IORedis, { type Redis } from 'ioredis';
import { z } from 'zod';
import type { Config } from './config.js';
import { registry, bridgeRequests } from './metrics.js';
import { settle, getStatus } from './settlement.js';
import { parseVaa, verifyVaa, parseTransferPayload, identifyToken, vaaDigest } from './wormhole-vaa.js';
import { convertXrpToLamports } from './price-oracle.js';
import { wormholeSettlementContext, xrplSettlementContext } from './workflow.js';

const XrplSubmitBody = z.object({
  tx_hash: z.string().min(64).max(64),
  sender: z.string().min(25).max(35),
  drops: z.string().regex(/^\d+$/),
  solana_pubkey: z.string().min(32).max(44),
  agent_did: z.string().min(32).max(64),
  ledger_index: z.number().int().positive(),
});

const WormholeBody = z.object({
  vaa: z.string().min(1),
  solana_pubkey: z.string().min(32).max(44),
  agent_did: z.string().min(32).max(64),
});

export type BuildOpts = {
  cfg: Config;
  redis?: Redis;
};

export function build(opts: BuildOpts) {
  const cfg = opts.cfg;
  const redis = opts.redis ?? new IORedis(cfg.redisUrl);
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  app.get('/health', async () => ({ status: 'ok', service: 'xrpl-bridge' }));

  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });

  app.post('/bridge/xrpl', async (req, reply) => {
    const parsed = XrplSubmitBody.safeParse(req.body);
    if (!parsed.success) {
      bridgeRequests.inc({ status: 'bad_request' });
      return reply.code(400).send({ error: parsed.error.message });
    }

    const body = parsed.data;

    try {
      const result = await settle(
        redis,
        {
          txHash: body.tx_hash,
          sender: body.sender,
          drops: BigInt(body.drops),
          solanaPubkey: body.solana_pubkey,
          agentDid: body.agent_did,
          ledgerIndex: body.ledger_index,
        },
        cfg.gatewayKeypair,
        cfg.solanaRpcUrl,
        cfg.cluster,
        xrplSettlementContext({
          txHash: body.tx_hash,
          sender: body.sender,
          drops: BigInt(body.drops),
          solanaPubkey: body.solana_pubkey,
          agentDid: body.agent_did,
          ledgerIndex: body.ledger_index,
        }),
      );

      return reply.send({
        ok: true,
        xrpl_tx_hash: result.txHash,
        sol_tx_sig: result.solTxSig,
        lamports: result.lamports.toString(),
        status: result.status,
        workflow_state: result.workflowState,
        intent: result.intent,
      });
    } catch (err) {
      bridgeRequests.inc({ status: 'settlement_error' });
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: 'settlement_failed', detail: msg });
    }
  });

  app.post('/bridge/wormhole', async (req, reply) => {
    const parsed = WormholeBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }

    let vaaBytes: Uint8Array;
    try {
      vaaBytes = Buffer.from(parsed.data.vaa, 'base64');
    } catch {
      return reply.code(400).send({ error: 'invalid base64 VAA' });
    }

    let vaa;
    try {
      vaa = parseVaa(vaaBytes);
    } catch (err) {
      return reply.code(400).send({ error: 'invalid VAA', detail: (err as Error).message });
    }

    const verification = verifyVaa(vaa);
    if (!verification.valid) {
      return reply.code(422).send({ error: 'VAA verification failed', detail: verification.reason });
    }

    let transfer;
    try {
      transfer = parseTransferPayload(vaa.payload);
    } catch (err) {
      return reply.code(400).send({ error: 'invalid transfer payload', detail: (err as Error).message });
    }

    const token = identifyToken(transfer.tokenAddress);
    const digest = vaaDigest(vaa).toString('hex');
    const context = wormholeSettlementContext({
      sourceChainId: transfer.sourceChain,
      amountAtomic: transfer.amount,
      beneficiaryDid: parsed.data.agent_did,
      tokenSymbol: token,
      digest,
    });
    if (!context) {
      return reply.code(422).send({ error: 'unsupported wormhole source chain', source_chain: transfer.sourceChain });
    }

    const lamports = await convertXrpToLamports(transfer.amount);

    try {
      const result = await settle(
        redis,
        {
          txHash: digest,
          sender: `wormhole:chain${transfer.sourceChain}`,
          drops: transfer.amount,
          solanaPubkey: parsed.data.solana_pubkey,
          agentDid: parsed.data.agent_did,
          ledgerIndex: 0,
        },
        cfg.gatewayKeypair,
        cfg.solanaRpcUrl,
        cfg.cluster,
        context,
      );

      return reply.send({
        ok: true,
        vaa_digest: digest,
        source_chain: transfer.sourceChain,
        token: token ?? 'unknown',
        amount: transfer.amount.toString(),
        sol_tx_sig: result.solTxSig,
        lamports: result.lamports.toString(),
        status: result.status,
        workflow_state: result.workflowState,
        intent: result.intent,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: 'wormhole_settlement_failed', detail: msg });
    }
  });

  app.get('/bridge/status/:txHash', async (req, reply) => {
    const { txHash } = req.params as { txHash: string };
    const result = await getStatus(redis, txHash);
    if (!result) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.send({
      xrpl_tx_hash: result.txHash,
      sol_tx_sig: result.solTxSig,
      lamports: result.lamports.toString(),
      status: result.status,
      workflow_state: result.workflowState,
      intent: result.intent,
    });
  });

  app.addHook('onClose', async () => {
    if (redis.status !== 'end') await redis.quit();
  });

  return app;
}
