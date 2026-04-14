import * as anchor from '@coral-xyz/anchor';
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

// Lazy provider so individual tests can bail early if localnet is not running.
export function getProvider(): anchor.AnchorProvider {
  // `anchor test` sets ANCHOR_PROVIDER_URL + ANCHOR_WALLET.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  return provider;
}

export async function fundedKeypair(
  provider: anchor.AnchorProvider,
  sol = 5,
): Promise<Keypair> {
  const kp = Keypair.generate();
  const sig = await provider.connection.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL);
  await provider.connection.confirmTransaction(sig, 'confirmed');
  return kp;
}

export async function airdrop(
  provider: anchor.AnchorProvider,
  pk: PublicKey,
  sol = 5,
): Promise<void> {
  const sig = await provider.connection.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
  await provider.connection.confirmTransaction(sig, 'confirmed');
}

export function loadProgram<T extends anchor.Idl>(name: string): anchor.Program<T> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const idl = require(`../../target/idl/${name}.json`) as T;
  return new anchor.Program<T>(idl, getProvider());
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) out[i] = Math.floor(Math.random() * 256);
  return out;
}

export function padRight(s: string, len: number): Buffer {
  const b = Buffer.alloc(len, 0);
  Buffer.from(s, 'utf8').copy(b, 0, 0, Math.min(s.length, len));
  return b;
}
