import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8788),
  HOST: z.string().default('0.0.0.0'),
  XRPL_WS_URL: z.string().default('wss://s1.ripple.com'),
  XRPL_BRIDGE_WALLET: z.string().min(25).max(35),
  SOLANA_RPC_URL: z.string().default('http://127.0.0.1:8899'),
  GATEWAY_KEYPAIR: z.string().min(1),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  PYTH_ENDPOINT: z.string().default('https://hermes.pyth.network'),
  MIN_XRP_AMOUNT: z.coerce.number().positive().default(1),
  CONFIRMATION_LEDGERS: z.coerce.number().int().min(1).default(4),
  SAEP_CLUSTER: z.enum(['mainnet-beta', 'devnet', 'localnet']).default('localnet'),
});

export type Config = {
  port: number;
  host: string;
  xrplWsUrl: string;
  xrplBridgeWallet: string;
  solanaRpcUrl: string;
  gatewayKeypair: string;
  redisUrl: string;
  pythEndpoint: string;
  minXrpAmount: number;
  confirmationLedgers: number;
  cluster: 'mainnet-beta' | 'devnet' | 'localnet';
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  return {
    port: parsed.PORT,
    host: parsed.HOST,
    xrplWsUrl: parsed.XRPL_WS_URL,
    xrplBridgeWallet: parsed.XRPL_BRIDGE_WALLET,
    solanaRpcUrl: parsed.SOLANA_RPC_URL,
    gatewayKeypair: parsed.GATEWAY_KEYPAIR,
    redisUrl: parsed.REDIS_URL,
    pythEndpoint: parsed.PYTH_ENDPOINT,
    minXrpAmount: parsed.MIN_XRP_AMOUNT,
    confirmationLedgers: parsed.CONFIRMATION_LEDGERS,
    cluster: parsed.SAEP_CLUSTER,
  };
}
