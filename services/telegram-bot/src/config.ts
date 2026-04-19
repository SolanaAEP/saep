import { z } from 'zod';

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  SOLANA_RPC_URL: z.string().default('https://api.devnet.solana.com'),
  SAEP_CLUSTER: z.enum(['mainnet-beta', 'devnet']).default('devnet'),
  PORTAL_URL: z.string().default('https://buildonsaep.com'),
  WEBHOOK_SECRET: z.string().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
});

export type Config = {
  botToken: string;
  rpcUrl: string;
  cluster: 'mainnet-beta' | 'devnet';
  portalUrl: string;
  webhookSecret?: string;
  port: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  return {
    botToken: parsed.TELEGRAM_BOT_TOKEN,
    rpcUrl: parsed.SOLANA_RPC_URL,
    cluster: parsed.SAEP_CLUSTER,
    portalUrl: parsed.PORTAL_URL,
    webhookSecret: parsed.WEBHOOK_SECRET,
    port: parsed.PORT,
  };
}
