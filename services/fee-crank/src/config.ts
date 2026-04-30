import { z } from 'zod';

const ConfigSchema = z.object({
  port: z.coerce.number().int().min(1024).max(65535).default(10001),
  rpcUrl: z.string().url().default('https://api.mainnet-beta.solana.com'),
  cluster: z.string().min(1).default('mainnet-beta'),
  saepMint: z.string().default('HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump'),
  feeCollectorProgramId: z.string().min(32),
  stakingProgramId: z.string().min(32).default('GjXfJ6MHb6SJ4XBK3qcpGw4n256qYPrDcXrNj6kf2i2Z'),
  databaseUrl: z.string().url().optional(),
  pollIntervalMs: z.coerce.number().int().min(60_000).default(600_000),
  maxHarvestAccounts: z.coerce.number().int().min(1).max(10).default(10),
  operatorKeypairPath: z.string(),
  logLevel: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse({
    port: env.FEE_CRANK_PORT,
    rpcUrl: env.SOLANA_RPC_URL ?? env.RPC_URL,
    cluster: env.SAEP_CLUSTER,
    saepMint: env.SAEP_MINT,
    feeCollectorProgramId:
      env.FEE_COLLECTOR_PROGRAM_ID ?? '4xLpFgjpZwJbf61UyvyMhmEBmeJzPaCyKvZeYuK2YFFu',
    stakingProgramId: env.NXS_STAKING_PROGRAM_ID,
    databaseUrl: env.DATABASE_URL,
    pollIntervalMs: env.FEE_CRANK_POLL_INTERVAL_MS,
    maxHarvestAccounts: env.FEE_CRANK_MAX_HARVEST_ACCOUNTS,
    operatorKeypairPath: env.OPERATOR_KEYPAIR_PATH,
    logLevel: env.LOG_LEVEL,
  });
}
