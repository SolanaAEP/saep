import { AnchorProvider, Program, BorshInstructionCoder, type Idl } from '@coral-xyz/anchor';
import { Connection, PublicKey, type TransactionInstruction } from '@solana/web3.js';

const stubWallet = {
  publicKey: PublicKey.unique(),
  signTransaction: async <T>(tx: T): Promise<T> => tx,
  signAllTransactions: async <T>(txs: T[]): Promise<T[]> => txs,
};

export function makeTestProgram<T extends Idl>(
  idl: Record<string, unknown>,
  programId: PublicKey,
): Program<T> {
  const connection = new Connection('http://127.0.0.1:65535');
  const provider = new AnchorProvider(connection, stubWallet as never, { commitment: 'confirmed' });
  const withAddr = { ...idl, address: programId.toBase58() } as T;
  return new Program<T>(withAddr, provider);
}

export function decodeIx(idl: Record<string, unknown>, ix: TransactionInstruction) {
  const coder = new BorshInstructionCoder(idl as Idl);
  const decoded = coder.decode(ix.data);
  if (!decoded) throw new Error('failed to decode ix');
  return decoded;
}

export function expectedDiscriminator(idl: Record<string, unknown>, ixName: string): number[] {
  const ixs = (idl as { instructions: { name: string; discriminator: number[] }[] }).instructions;
  const found = ixs.find((i) => i.name === ixName);
  if (!found) throw new Error(`ix ${ixName} not in idl`);
  return found.discriminator;
}

export function accountKeys(ix: TransactionInstruction): string[] {
  return ix.keys.map((k) => k.pubkey.toBase58());
}
