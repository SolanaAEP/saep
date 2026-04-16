import { readFileSync } from 'node:fs';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair } from '@solana/web3.js';
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

export type Cluster = z.infer<typeof ClusterSchema>;

export type Config = {
  cluster: Cluster;
  rpcUrl: string;
  operatorKeypairPath: string | undefined;
  autoSign: boolean;
  keypair: Keypair | null;
  connection: Connection;
  provider: AnchorProvider;
};

const DEFAULT_RPC: Record<Cluster, string> = {
  localnet: 'http://127.0.0.1:8899',
  devnet: 'https://api.devnet.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
};

function loadKeypair(path: string | undefined): Keypair | null {
  if (!path) return null;
  const raw = readFileSync(path, 'utf8');
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
}

export function loadConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Config {
  const parsed = EnvSchema.parse(env);
  const rpcUrl = parsed.SAEP_RPC_URL ?? DEFAULT_RPC[parsed.SAEP_CLUSTER];
  const connection = new Connection(rpcUrl, 'confirmed');
  const keypair = loadKeypair(parsed.SAEP_OPERATOR_KEYPAIR);
  const wallet = new Wallet(keypair ?? Keypair.generate());
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });

  return {
    cluster: parsed.SAEP_CLUSTER,
    rpcUrl,
    operatorKeypairPath: parsed.SAEP_OPERATOR_KEYPAIR,
    autoSign: parsed.SAEP_AUTO_SIGN,
    keypair,
    connection,
    provider,
  };
}
