import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
} from '@solana/spl-token';
import { PublicKey, type Connection } from '@solana/web3.js';

export async function resolveTokenProgramForMint(
  connection: Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  const mintAccount = await connection.getAccountInfo(mint, 'confirmed');
  if (!mintAccount) {
    throw new Error(`Mint ${mint.toBase58()} was not found on the current cluster`);
  }
  if (mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  if (mintAccount.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  throw new Error('Mint is not owned by SPL Token or Token-2022');
}

export async function loadTokenAccountBalance(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
): Promise<{ address: PublicKey; amount: bigint; decimals: number; tokenProgram: PublicKey }> {
  const tokenProgram = await resolveTokenProgramForMint(connection, mint);
  const address = getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
  const [account, mintInfo] = await Promise.all([
    getAccount(connection, address, 'confirmed', tokenProgram),
    getMint(connection, mint, 'confirmed', tokenProgram),
  ]);
  return {
    address,
    amount: account.amount,
    decimals: mintInfo.decimals,
    tokenProgram,
  };
}

export async function loadMintDecimals(
  connection: Connection,
  mint: PublicKey,
): Promise<number> {
  const tokenProgram = await resolveTokenProgramForMint(connection, mint);
  const mintInfo = await getMint(connection, mint, 'confirmed', tokenProgram);
  return mintInfo.decimals;
}
