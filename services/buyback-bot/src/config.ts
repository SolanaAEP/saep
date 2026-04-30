import { z } from 'zod';

const Mode = z.enum(['observe', 'active']);

const ConfigSchema = z.object({
  port: z.coerce.number().int().min(1024).max(65535).default(10000),
  rpcUrl: z.string().url().default('https://api.mainnet-beta.solana.com'),
  cluster: z.string().min(1).default('mainnet-beta'),
  mode: Mode.default('observe'),
  saepMint: z.string().default('HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump'),
  usdcMint: z.string().default('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  taskMarketProgramId: z.string().min(32),
  feeCollectorProgramId: z.string().min(32),
  feeAccumulatorAccount: z.string().min(32).optional(),
  pollIntervalMs: z.coerce.number().int().min(60_000).default(3_600_000),
  swapThresholdUsdc: z.coerce.number().int().nonnegative().default(50_000_000),
  slippageBps: z.coerce.number().int().min(1).max(1000).default(200),
  jupiterApiUrl: z.string().url().default('https://quote-api.jup.ag/v6'),
  operatorKeypairPath: z.string().optional(),
  operatorKeypairJson: z.string().optional(),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;
export type Mode = z.infer<typeof Mode>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse({
    port: env.BUYBACK_PORT,
    rpcUrl: env.SOLANA_RPC_URL ?? env.RPC_URL,
    cluster: env.SAEP_CLUSTER,
    mode: env.BUYBACK_MODE,
    saepMint: env.SAEP_MINT,
    usdcMint: env.USDC_MINT,
    taskMarketProgramId:
      env.TASK_MARKET_PROGRAM_ID ?? 'HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w',
    feeCollectorProgramId:
      env.FEE_COLLECTOR_PROGRAM_ID ?? '4xLpFgjpZwJbf61UyvyMhmEBmeJzPaCyKvZeYuK2YFFu',
    feeAccumulatorAccount: env.BUYBACK_FEE_ACCUMULATOR_ACCOUNT,
    pollIntervalMs: env.BUYBACK_POLL_INTERVAL_MS,
    swapThresholdUsdc: env.BUYBACK_SWAP_THRESHOLD_USDC_BASE,
    slippageBps: env.BUYBACK_SLIPPAGE_BPS,
    jupiterApiUrl: env.JUPITER_API_URL,
    operatorKeypairPath: env.OPERATOR_KEYPAIR_PATH,
    operatorKeypairJson: env.OPERATOR_KEYPAIR_JSON,
    logLevel: env.LOG_LEVEL,
  });
}
