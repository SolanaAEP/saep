import { readFileSync, statSync } from 'node:fs';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair } from '@solana/web3.js';
import { z } from 'zod';
import type { SaepCluster } from '@saep/sdk';

const ClusterSchema = z.enum(['localnet', 'devnet', 'mainnet-beta'] as [SaepCluster, ...SaepCluster[]]);

const EnvSchema = z.object({
  SAEP_CLUSTER: ClusterSchema.default('devnet'),
  SAEP_RPC_URL: z.string().url().optional(),
  SAEP_OPERATOR_KEYPAIR: z.string().optional(),
  SAEP_AUTO_SIGN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SAEP_AUTO_SIGN_MAX_LAMPORTS: z
    .string()
    .regex(/^\d+$/)
    .default('1000000')
    .transform((v) => Number(v)),
  SAEP_AUTO_SIGN_VELOCITY_LIMIT: z
    .string()
    .regex(/^\d+$/)
    .default('10')
    .transform((v) => Number(v)),
  SAEP_ALLOWED_TOOLS: z
    .string()
    .optional()
    .transform((v) => (v ? new Set(v.split(',').map((s) => s.trim()).filter(Boolean)) : null)),
});

export type { SaepCluster };

export type Config = {
  cluster: SaepCluster;
  rpcUrl: string;
  operatorKeypairPath: string | undefined;
  autoSign: boolean;
  autoSignMaxLamports: number;
  autoSignVelocityLimit: number;
  allowedTools: Set<string> | null;
  keypair: Keypair | null;
  connection: Connection;
  provider: AnchorProvider;
};

const DEFAULT_RPC: Record<SaepCluster, string> = {
  localnet: 'http://127.0.0.1:8899',
  devnet: 'https://api.devnet.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
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

export function loadConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Config {
  const parsed = EnvSchema.parse(env);
  const rpcUrl = parsed.SAEP_RPC_URL ?? DEFAULT_RPC[parsed.SAEP_CLUSTER];
  const connection = new Connection(rpcUrl, 'confirmed');
  const keypair = loadKeypair(parsed.SAEP_OPERATOR_KEYPAIR);
  if (!keypair && parsed.SAEP_AUTO_SIGN) {
    throw new Error('SAEP_AUTO_SIGN=true requires SAEP_OPERATOR_KEYPAIR to be set');
  }
  if (!keypair) {
    process.stderr.write('WARNING: no SAEP_OPERATOR_KEYPAIR set — using ephemeral keypair (read-only mode)\n');
  }
  const wallet = new Wallet(keypair ?? Keypair.generate());
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });

  return {
    cluster: parsed.SAEP_CLUSTER,
    rpcUrl,
    operatorKeypairPath: parsed.SAEP_OPERATOR_KEYPAIR,
    autoSign: parsed.SAEP_AUTO_SIGN,
    autoSignMaxLamports: parsed.SAEP_AUTO_SIGN_MAX_LAMPORTS,
    autoSignVelocityLimit: parsed.SAEP_AUTO_SIGN_VELOCITY_LIMIT,
    allowedTools: parsed.SAEP_ALLOWED_TOOLS,
    keypair,
    connection,
    provider,
  };
}
