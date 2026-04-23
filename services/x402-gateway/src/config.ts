import { readFileSync, statSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
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
  X402_TASK_DEADLINE_SECS: z.coerce.number().int().min(61).default(300),
  SAEP_CLUSTER: z.enum(['mainnet-beta', 'devnet', 'localnet']).default('localnet'),
  SAEP_OPERATOR_KEYPAIR: z.string().optional(),
  X402_RECIPIENT_OPERATOR_KEYPAIR: z.string().optional(),
  SAEP_TASK_MARKET_PROGRAM_ID: z.string().optional(),
  SAEP_AGENT_REGISTRY_PROGRAM_ID: z.string().optional(),
  X402_DEMO_PAYMENT_MINT: z.string().optional(),
  X402_DEMO_PAYMENT_AMOUNT: z
    .string()
    .regex(/^\d+$/)
    .default('1000000')
    .transform((v) => BigInt(v)),
  X402_DEMO_RECIPIENT_DID: z.string().optional(),
  X402_DEMO_RESOURCE: z.string().default('/demo/paid'),
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
  taskDeadlineSecs: number;
  cluster: 'mainnet-beta' | 'devnet' | 'localnet';
  operatorKeypairPath?: string;
  keypair: Keypair | null;
  recipientOperatorKeypairPath?: string;
  recipientKeypair: Keypair | null;
  taskMarketProgramId?: string;
  agentRegistryProgramId?: string;
  demoPaymentMint?: string;
  demoPaymentAmount: bigint;
  demoRecipientDid?: string;
  demoResource: string;
};

function loadKeypair(path: string | undefined): Keypair | null {
  if (!path) return null;
  const mode = statSync(path).mode & 0o777;
  if (mode & 0o044) {
    process.stderr.write(
      `WARNING: keypair file ${path} has permissions ${mode.toString(8).padStart(4, '0')}, recommended 0600\n`,
    );
  }
  const raw = readFileSync(path, 'utf8');
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  const keypair = loadKeypair(parsed.SAEP_OPERATOR_KEYPAIR);
  const recipientKeypair = loadKeypair(parsed.X402_RECIPIENT_OPERATOR_KEYPAIR);
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
    taskDeadlineSecs: parsed.X402_TASK_DEADLINE_SECS,
    cluster: parsed.SAEP_CLUSTER,
    operatorKeypairPath: parsed.SAEP_OPERATOR_KEYPAIR,
    keypair,
    recipientOperatorKeypairPath: parsed.X402_RECIPIENT_OPERATOR_KEYPAIR,
    recipientKeypair,
    taskMarketProgramId: parsed.SAEP_TASK_MARKET_PROGRAM_ID,
    agentRegistryProgramId: parsed.SAEP_AGENT_REGISTRY_PROGRAM_ID,
    demoPaymentMint: parsed.X402_DEMO_PAYMENT_MINT,
    demoPaymentAmount: parsed.X402_DEMO_PAYMENT_AMOUNT,
    demoRecipientDid: parsed.X402_DEMO_RECIPIENT_DID,
    demoResource: parsed.X402_DEMO_RESOURCE,
  };
}
