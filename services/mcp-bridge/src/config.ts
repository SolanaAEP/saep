import { z } from 'zod';

const ClusterSchema = z.enum(['localnet', 'devnet', 'mainnet-beta']);

const EnvSchema = z.object({
  SAEP_CLUSTER: ClusterSchema.default('devnet'),
  SAEP_RPC_URL: z.string().url().optional(),
  SAEP_OPERATOR_KEYPAIR: z.string().optional(),
  SAEP_AUTO_SIGN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Config = {
  cluster: z.infer<typeof ClusterSchema>;
  rpcUrl: string;
  operatorKeypairPath: string | undefined;
  autoSign: boolean;
};

const DEFAULT_RPC: Record<z.infer<typeof ClusterSchema>, string> = {
  localnet: 'http://127.0.0.1:8899',
  devnet: 'https://api.devnet.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  return {
    cluster: parsed.SAEP_CLUSTER,
    rpcUrl: parsed.SAEP_RPC_URL ?? DEFAULT_RPC[parsed.SAEP_CLUSTER],
    operatorKeypairPath: parsed.SAEP_OPERATOR_KEYPAIR,
    autoSign: parsed.SAEP_AUTO_SIGN,
  };
}
