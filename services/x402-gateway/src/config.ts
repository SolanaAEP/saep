import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().default('0.0.0.0'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  ALLOW_PATTERN: z.string().default('*.saep.example'),
  ALLOW_LIST: z.string().default(''),
  RATE_PER_MIN: z.coerce.number().int().positive().default(100),
  RATE_PER_DAY: z.coerce.number().int().positive().default(10_000),
  CCTP_ATTESTATION_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  MAX_BUDGET_LAMPORTS: z.coerce.number().int().positive().default(1_000_000_000),
  SOLANA_RPC_URL: z.string().default('http://127.0.0.1:8899'),
  PROXY_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  MAX_402_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
});

export type Config = {
  port: number;
  host: string;
  redisUrl: string;
  allowPattern: string;
  allowList: string[];
  ratePerMin: number;
  ratePerDay: number;
  cctpTimeoutMs: number;
  maxBudgetLamports: number;
  solanaRpcUrl: string;
  proxyTimeoutMs: number;
  max402Retries: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  return {
    port: parsed.PORT,
    host: parsed.HOST,
    redisUrl: parsed.REDIS_URL,
    allowPattern: parsed.ALLOW_PATTERN,
    allowList: parsed.ALLOW_LIST.split(',').map((s) => s.trim()).filter(Boolean),
    ratePerMin: parsed.RATE_PER_MIN,
    ratePerDay: parsed.RATE_PER_DAY,
    cctpTimeoutMs: parsed.CCTP_ATTESTATION_TIMEOUT_MS,
    maxBudgetLamports: parsed.MAX_BUDGET_LAMPORTS,
    solanaRpcUrl: parsed.SOLANA_RPC_URL,
    proxyTimeoutMs: parsed.PROXY_TIMEOUT_MS,
    max402Retries: parsed.MAX_402_RETRIES,
  };
}
