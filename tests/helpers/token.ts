import {
  Keypair, PublicKey, SystemProgram, Transaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
} from '@solana/spl-token';
import { ProgramTestContext } from 'solana-bankrun';

export async function sendTx(
  ctx: ProgramTestContext,
  tx: Transaction,
  signers: Keypair[],
): Promise<void> {
  tx.recentBlockhash = ctx.lastBlockhash;
  tx.feePayer = signers[0]!.publicKey;
  tx.sign(...signers);
  await ctx.banksClient.processTransaction(tx);
}

export async function createMint(
  ctx: ProgramTestContext,
  payer: Keypair,
  mintAuthority: PublicKey,
  decimals: number,
  tokenProgramId: PublicKey,
): Promise<PublicKey> {
  const mintKeypair = Keypair.generate();
  const space = getMintLen([]);
  const rent = await ctx.banksClient.getRent();
  const lamports = Number(rent.minimumBalance(BigInt(space)));
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space,
      lamports,
      programId: tokenProgramId,
    }),
    createInitializeMint2Instruction(
      mintKeypair.publicKey, decimals, mintAuthority, null, tokenProgramId,
    ),
  );
  await sendTx(ctx, tx, [payer, mintKeypair]);
  return mintKeypair.publicKey;
}

export function createToken2022Mint(
  ctx: ProgramTestContext,
  payer: Keypair,
  mintAuthority: PublicKey,
  decimals: number,
): Promise<PublicKey> {
  return createMint(ctx, payer, mintAuthority, decimals, TOKEN_2022_PROGRAM_ID);
}

export async function createATA(
  ctx: ProgramTestContext,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgramId: PublicKey = TOKEN_2022_PROGRAM_ID,
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true, tokenProgramId);
  const tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey, ata, owner, mint, tokenProgramId,
    ),
  );
  await sendTx(ctx, tx, [payer]);
  return ata;
}

export async function mintTokens(
  ctx: ProgramTestContext,
  payer: Keypair,
  mint: PublicKey,
  dest: PublicKey,
  authority: Keypair,
  amount: number,
  tokenProgramId: PublicKey = TOKEN_2022_PROGRAM_ID,
): Promise<void> {
  const tx = new Transaction().add(
    createMintToInstruction(mint, dest, authority.publicKey, amount, [], tokenProgramId),
  );
  await sendTx(ctx, tx, [payer, authority]);
}

export async function getTokenBalance(
  ctx: ProgramTestContext,
  ata: PublicKey,
): Promise<bigint> {
  const acct = await ctx.banksClient.getAccount(ata);
  if (!acct) return 0n;
  return Buffer.from(acct.data).readBigUInt64LE(64);
}
