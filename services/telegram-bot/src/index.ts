import { loadConfig } from './config.js';
import { createBotContext } from './context.js';
import { createBot } from './bot.js';

async function main() {
  const cfg = loadConfig();
  const ctx = createBotContext(cfg);
  const bot = createBot(cfg.botToken, ctx);

  bot.catch((err) => {
    console.error('[saep-bot] unhandled error:', err);
  });

  if (cfg.webhookSecret) {
    const { webhookCallback } = await import('grammy');
    const { default: Fastify } = await import('fastify');
    const app = Fastify({ logger: { level: 'info' } });

    app.post('/webhook', async (req, reply) => {
      const cb = webhookCallback(bot, 'std/http');
      const response = await cb(new Request(`http://localhost/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req.body),
      }));
      reply.code(response.status).send(await response.text());
    });

    app.get('/healthz', async () => ({ status: 'ok' }));

    await app.listen({ port: cfg.port, host: '0.0.0.0' });
    console.log(`[saep-bot] webhook server on :${cfg.port}`);
  } else {
    await bot.start();
    console.log('[saep-bot] polling started');
  }
}

main().catch((err) => {
  console.error('[saep-bot] fatal:', err);
  process.exit(1);
});
