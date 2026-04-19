import { Bot } from 'grammy';
import type { BotContext } from './context.js';
import {
  handleAgents,
  handleHire,
  handlePortfolio,
  handleRegister,
  handleStart,
  handleStatus,
} from './commands.js';

export function createBot(token: string, ctx: BotContext): Bot {
  const bot = new Bot(token);

  bot.command('start', async (c) => {
    await c.reply(handleStart(ctx), { parse_mode: 'Markdown' });
  });

  bot.command('help', async (c) => {
    await c.reply(handleStart(ctx), { parse_mode: 'Markdown' });
  });

  bot.command('agents', async (c) => {
    const text = await handleAgents(ctx);
    await c.reply(text, { parse_mode: 'Markdown' });
  });

  bot.command('hire', async (c) => {
    const cap = c.match?.trim();
    if (!cap) {
      await c.reply('Usage: /hire <capability>\nExample: /hire Swap');
      return;
    }
    const text = await handleHire(ctx, cap);
    await c.reply(text, { parse_mode: 'Markdown' });
  });

  bot.command('status', async (c) => {
    const taskId = c.match?.trim();
    if (!taskId) {
      await c.reply('Usage: /status <task_address>');
      return;
    }
    const text = await handleStatus(ctx, taskId);
    await c.reply(text, { parse_mode: 'Markdown' });
  });

  bot.command('portfolio', async (c) => {
    const wallet = c.match?.trim();
    if (!wallet) {
      await c.reply('Usage: /portfolio <wallet_address>');
      return;
    }
    const text = await handlePortfolio(ctx, wallet);
    await c.reply(text, { parse_mode: 'Markdown' });
  });

  bot.command('register', async (c) => {
    await c.reply(handleRegister(ctx), { parse_mode: 'Markdown' });
  });

  return bot;
}
