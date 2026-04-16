import { BN, Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import type { TreasuryStandard } from '../generated/treasury_standard.js';
import {
  treasuryGlobalPda,
  treasuryAllowedMintsPda,
  treasuryPda,
  vaultPda,
  agentRegistryGlobalPda,
  agentAccountPda,
  streamPda,
  streamEscrowPda,
} from '../pda/index.js';

const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const SYSVAR_RENT = new PublicKey('SysvarRent111111111111111111111111111111111');
const AGENT_REGISTRY_PROGRAM_ID = new PublicKey('EQJ4Lp2gxJDD5hs185aDcermYWdAi4cQeSKfnuqLAQYu');

export interface InitTreasuryInput {
  operator: PublicKey;
  agentDid: Uint8Array;
  agentOperator: PublicKey;
  agentId: Uint8Array;
  dailySpendLimit: bigint;
  perTxLimit: bigint;
  weeklyLimit: bigint;
}

export async function buildInitTreasuryIx(
  program: Program<TreasuryStandard>,
  input: InitTreasuryInput,
): Promise<TransactionInstruction> {
  const [global] = treasuryGlobalPda(program.programId);
  const [treasury] = treasuryPda(program.programId, input.agentDid);
  const [registryGlobal] = agentRegistryGlobalPda(AGENT_REGISTRY_PROGRAM_ID);
  const [agentAccount] = agentAccountPda(AGENT_REGISTRY_PROGRAM_ID, input.agentOperator, input.agentId);

  return program.methods
    .initTreasury(
      Array.from(input.agentDid) as unknown as number[],
      new BN(input.dailySpendLimit.toString()),
      new BN(input.perTxLimit.toString()),
      new BN(input.weeklyLimit.toString()),
    )
    .accounts({
      global,
      treasury,
      operator: input.operator,
      agentRegistryProgram: AGENT_REGISTRY_PROGRAM_ID,
      registryGlobal,
      agentAccount,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface WithdrawInput {
  operator: PublicKey;
  agentDid: Uint8Array;
  mint: PublicKey;
  destination: PublicKey;
  amount: bigint;
  priceFeed?: PublicKey;
}

export async function buildWithdrawIx(
  program: Program<TreasuryStandard>,
  input: WithdrawInput,
): Promise<TransactionInstruction> {
  const [global] = treasuryGlobalPda(program.programId);
  const [treasury] = treasuryPda(program.programId, input.agentDid);
  const [vault] = vaultPda(program.programId, input.agentDid, input.mint);

  return program.methods
    .withdraw(new BN(input.amount.toString()))
    .accounts({
      global,
      treasury,
      mint: input.mint,
      vault,
      destination: input.destination,
      priceFeed: input.priceFeed ?? null,
      operator: input.operator,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    } as never)
    .instruction();
}

export interface InitStreamInput {
  client: PublicKey;
  agentDid: Uint8Array;
  streamNonce: Uint8Array;
  payerMint: PublicKey;
  payoutMint: PublicKey;
  clientTokenAccount: PublicKey;
  ratePerSec: bigint;
  maxDuration: bigint;
}

export async function buildInitStreamIx(
  program: Program<TreasuryStandard>,
  input: InitStreamInput,
): Promise<TransactionInstruction> {
  const [global] = treasuryGlobalPda(program.programId);
  const [allowedMints] = treasuryAllowedMintsPda(program.programId);
  const [treasury] = treasuryPda(program.programId, input.agentDid);
  const [stream] = streamPda(program.programId, input.agentDid, input.client, input.streamNonce);
  const [escrow] = streamEscrowPda(program.programId, stream);

  return program.methods
    .initStream(
      Array.from(input.streamNonce) as unknown as number[],
      new BN(input.ratePerSec.toString()),
      new BN(input.maxDuration.toString()),
    )
    .accounts({
      global,
      allowedMints,
      treasury,
      stream,
      payerMint: input.payerMint,
      payoutMint: input.payoutMint,
      escrow,
      clientTokenAccount: input.clientTokenAccount,
      client: input.client,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT,
    } as never)
    .instruction();
}

export interface CloseStreamInput {
  signer: PublicKey;
  stream: PublicKey;
  treasury: PublicKey;
  payerMint: PublicKey;
  agentDid: Uint8Array;
  clientTokenAccount: PublicKey;
}

export async function buildCloseStreamIx(
  program: Program<TreasuryStandard>,
  input: CloseStreamInput,
): Promise<TransactionInstruction> {
  const [escrow] = streamEscrowPda(program.programId, input.stream);
  const [agentVault] = vaultPda(program.programId, input.agentDid, input.payerMint);

  return program.methods
    .closeStream()
    .accounts({
      treasury: input.treasury,
      stream: input.stream,
      payerMint: input.payerMint,
      escrow,
      agentVault,
      clientTokenAccount: input.clientTokenAccount,
      signer: input.signer,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    } as never)
    .instruction();
}

export interface WithdrawEarnedInput {
  operator: PublicKey;
  agentDid: Uint8Array;
  stream: PublicKey;
  payerMint: PublicKey;
  payoutMint: PublicKey;
  jupiterProgram: PublicKey;
  routeData: Uint8Array;
  payerPriceFeed?: PublicKey;
  payoutPriceFeed?: PublicKey;
}

export async function buildWithdrawEarnedIx(
  program: Program<TreasuryStandard>,
  input: WithdrawEarnedInput,
): Promise<TransactionInstruction> {
  const [global] = treasuryGlobalPda(program.programId);
  const [treasury] = treasuryPda(program.programId, input.agentDid);
  const [escrow] = streamEscrowPda(program.programId, input.stream);
  const [agentVault] = vaultPda(program.programId, input.agentDid, input.payoutMint);

  return program.methods
    .withdrawEarned(Buffer.from(input.routeData))
    .accounts({
      global,
      treasury,
      stream: input.stream,
      payerMint: input.payerMint,
      payoutMint: input.payoutMint,
      escrow,
      agentVault,
      jupiterProgram: input.jupiterProgram,
      payerPriceFeed: input.payerPriceFeed ?? null,
      payoutPriceFeed: input.payoutPriceFeed ?? null,
      operator: input.operator,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    } as never)
    .instruction();
}
