import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { resolveCluster, makeProvider } from '@saep/sdk';
import type { Connection } from '@solana/web3.js';
import type { HandlerContext, Wallet, SaepCluster } from './types.js';

export function toBrowserWallet(w: Wallet) {
  const signAll =
    w.signAllTransactions?.bind(w) ??
    (async <T>(txs: T[]): Promise<T[]> => {
      const out: T[] = [];
      for (const tx of txs) out.push(await (w.signTransaction as (t: T) => Promise<T>)(tx));
      return out;
    });
  return {
    publicKey: w.publicKey,
    signTransaction: w.signTransaction.bind(w),
    signAllTransactions: signAll,
  };
}

export function createHandlerContext(
  cluster: SaepCluster,
  connection: Connection,
  wallet: Wallet,
): HandlerContext {
  const config = resolveCluster({ cluster });
  const provider = makeProvider({
    connection,
    wallet: toBrowserWallet(wallet),
  });
  return {
    cluster,
    config,
    provider,
    operator: wallet.publicKey,
    connection,
  };
}

export async function resolveTokenProgram(
  connection: Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint, 'confirmed');
  if (!info) throw new Error(`mint ${mint.toBase58()} was not found`);
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  throw new Error(`mint ${mint.toBase58()} is not an SPL token mint`);
}
