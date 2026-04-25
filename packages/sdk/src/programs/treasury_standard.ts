import { BN, Program } from '../anchor.js';
import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from '@solana/web3.js';
import type { TreasuryStandard } from '../generated/treasury_standard.js';
import type { ClusterConfig } from '../cluster/index.js';
import {
  treasuryGlobalPda,
  treasuryAllowedMintsPda,
  treasuryPda,
  treasuryYieldConfigPda,
  treasuryYieldPositionPda,
  treasuryYieldReceiptVaultPda,
  treasuryYieldStrategyPda,
  vaultPda,
  agentRegistryGlobalPda,
  agentAccountPda,
  reentrancyGuardPda,
  streamPda,
  streamEscrowPda,
} from '../pda/index.js';

const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const SYSVAR_RENT = new PublicKey('SysvarRent111111111111111111111111111111111');
const MAX_YIELD_ROUTE_DATA_LEN = 512;

export type TreasuryYieldVenue = 'kamino' | 'marginfi' | 'drift';
export type TreasuryYieldRiskTier = 'conservative' | 'moderate' | 'aggressive';
export type TreasuryYieldStrategyStatus = 'active' | 'paused' | 'revoked';

type AnchorEnum<T extends string> = Record<T, Record<string, never>>;

function yieldVenueArg(venue: TreasuryYieldVenue): AnchorEnum<'kamino' | 'marginfi' | 'drift'> {
  return { [venue]: {} } as AnchorEnum<'kamino' | 'marginfi' | 'drift'>;
}

function yieldRiskTierArg(
  riskTier: TreasuryYieldRiskTier,
): AnchorEnum<'conservative' | 'moderate' | 'aggressive'> {
  return { [riskTier]: {} } as AnchorEnum<'conservative' | 'moderate' | 'aggressive'>;
}

function yieldStrategyStatusArg(
  status: TreasuryYieldStrategyStatus,
): AnchorEnum<'active' | 'paused' | 'revoked'> {
  return { [status]: {} } as AnchorEnum<'active' | 'paused' | 'revoked'>;
}

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
  config: ClusterConfig,
  input: InitTreasuryInput,
): Promise<TransactionInstruction> {
  const [global] = treasuryGlobalPda(program.programId);
  const [treasury] = treasuryPda(program.programId, input.agentDid);
  const [registryGlobal] = agentRegistryGlobalPda(config.programIds.agentRegistry);
  const [agentAccount] = agentAccountPda(config.programIds.agentRegistry, input.agentOperator, input.agentId);

  return program.methods
    .initTreasury(
      Array.from(input.agentDid),
      new BN(input.dailySpendLimit.toString()),
      new BN(input.perTxLimit.toString()),
      new BN(input.weeklyLimit.toString()),
    )
    .accounts({
      global,
      treasury,
      operator: input.operator,
      agentRegistryProgram: config.programIds.agentRegistry,
      registryGlobal,
      agentAccount,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface SetLimitsInput {
  operator: PublicKey;
  agentDid: Uint8Array;
  daily: bigint;
  perTx: bigint;
  weekly: bigint;
}

export async function buildSetLimitsIx(
  program: Program<TreasuryStandard>,
  input: SetLimitsInput,
): Promise<TransactionInstruction> {
  const [global] = treasuryGlobalPda(program.programId);
  const [treasury] = treasuryPda(program.programId, input.agentDid);

  return program.methods
    .setLimits(
      new BN(input.daily.toString()),
      new BN(input.perTx.toString()),
      new BN(input.weekly.toString()),
    )
    .accounts({
      global,
      treasury,
      operator: input.operator,
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
      Array.from(input.streamNonce),
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
  allowedTargets?: PublicKey | null;
  hookAllowlist?: PublicKey | null;
  agentHooks?: PublicKey | null;
  tokenProgramId?: PublicKey;
}

export async function buildWithdrawEarnedIx(
  program: Program<TreasuryStandard>,
  input: WithdrawEarnedInput,
): Promise<TransactionInstruction> {
  const [global] = treasuryGlobalPda(program.programId);
  const [treasury] = treasuryPda(program.programId, input.agentDid);
  const [escrow] = streamEscrowPda(program.programId, input.stream);
  const [agentVault] = vaultPda(program.programId, input.agentDid, input.payoutMint);
  const [guard] = reentrancyGuardPda(program.programId);

  return program.methods
    .withdrawEarned(Buffer.from(input.routeData))
    .accounts({
      global,
      treasury,
      allowedTargets: input.allowedTargets ?? null,
      stream: input.stream,
      payerMint: input.payerMint,
      payoutMint: input.payoutMint,
      escrow,
      agentVault,
      jupiterProgram: input.jupiterProgram,
      payerPriceFeed: input.payerPriceFeed ?? null,
      payoutPriceFeed: input.payoutPriceFeed ?? null,
      hookAllowlist: input.hookAllowlist ?? null,
      agentHooks: input.agentHooks ?? null,
      guard,
      operator: input.operator,
      tokenProgram: input.tokenProgramId ?? TOKEN_2022_PROGRAM_ID,
    } as never)
    .instruction();
}

export interface RegisterYieldStrategyInput {
  authority: PublicKey;
  strategyId: Uint8Array;
  venue: TreasuryYieldVenue;
  strategyProgram: PublicKey;
  underlyingMint: PublicKey;
  receiptMint: PublicKey;
  maxAllocationBps: number;
  riskTier: TreasuryYieldRiskTier;
  name: string;
  metadataUri: string;
}

export async function buildRegisterYieldStrategyIx(
  program: Program<TreasuryStandard>,
  input: RegisterYieldStrategyInput,
): Promise<TransactionInstruction> {
  const [global] = treasuryGlobalPda(program.programId);
  const [strategy] = treasuryYieldStrategyPda(program.programId, input.strategyId);

  return program.methods
    .registerYieldStrategy(
      Array.from(input.strategyId),
      yieldVenueArg(input.venue),
      input.strategyProgram,
      input.underlyingMint,
      input.receiptMint,
      input.maxAllocationBps,
      yieldRiskTierArg(input.riskTier),
      input.name,
      input.metadataUri,
    )
    .accounts({
      global,
      strategy,
      authority: input.authority,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface SetYieldStrategyStatusInput {
  authority: PublicKey;
  strategyId: Uint8Array;
  status: TreasuryYieldStrategyStatus;
}

export async function buildSetYieldStrategyStatusIx(
  program: Program<TreasuryStandard>,
  input: SetYieldStrategyStatusInput,
): Promise<TransactionInstruction> {
  const [global] = treasuryGlobalPda(program.programId);
  const [strategy] = treasuryYieldStrategyPda(program.programId, input.strategyId);

  return program.methods
    .setYieldStrategyStatus(yieldStrategyStatusArg(input.status))
    .accounts({
      global,
      strategy,
      authority: input.authority,
    } as never)
    .instruction();
}

export interface SetTreasuryYieldConfigInput {
  operator: PublicKey;
  agentDid: Uint8Array;
  strategyId: Uint8Array;
  allocationBps: number;
  paused?: boolean;
}

export async function buildSetTreasuryYieldConfigIx(
  program: Program<TreasuryStandard>,
  input: SetTreasuryYieldConfigInput,
): Promise<TransactionInstruction> {
  const [global] = treasuryGlobalPda(program.programId);
  const [treasury] = treasuryPda(program.programId, input.agentDid);
  const [strategy] = treasuryYieldStrategyPda(program.programId, input.strategyId);
  const [yieldConfig] = treasuryYieldConfigPda(program.programId, input.agentDid);

  return program.methods
    .setTreasuryYieldConfig(
      Array.from(input.agentDid),
      Array.from(input.strategyId),
      input.allocationBps,
      input.paused ?? false,
    )
    .accounts({
      global,
      treasury,
      strategy,
      yieldConfig,
      operator: input.operator,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
}

export interface RequestTreasuryYieldUnwindInput {
  operator: PublicKey;
  agentDid: Uint8Array;
}

export async function buildRequestTreasuryYieldUnwindIx(
  program: Program<TreasuryStandard>,
  input: RequestTreasuryYieldUnwindInput,
): Promise<TransactionInstruction> {
  const [global] = treasuryGlobalPda(program.programId);
  const [treasury] = treasuryPda(program.programId, input.agentDid);
  const [yieldConfig] = treasuryYieldConfigPda(program.programId, input.agentDid);

  return program.methods
    .requestTreasuryYieldUnwind()
    .accounts({
      global,
      treasury,
      yieldConfig,
      operator: input.operator,
    } as never)
    .instruction();
}

export interface RecordTreasuryYieldAccountingInput {
  authority: PublicKey;
  agentDid: Uint8Array;
  idleAmount: bigint;
  deployedAmount: bigint;
  realizedYieldAmount: bigint;
  accountingSlot: bigint;
}

export async function buildRecordTreasuryYieldAccountingIx(
  program: Program<TreasuryStandard>,
  input: RecordTreasuryYieldAccountingInput,
): Promise<TransactionInstruction> {
  const [global] = treasuryGlobalPda(program.programId);
  const [yieldConfig] = treasuryYieldConfigPda(program.programId, input.agentDid);

  return program.methods
    .recordTreasuryYieldAccounting(
      new BN(input.idleAmount.toString()),
      new BN(input.deployedAmount.toString()),
      new BN(input.realizedYieldAmount.toString()),
      new BN(input.accountingSlot.toString()),
    )
    .accounts({
      global,
      yieldConfig,
      authority: input.authority,
    } as never)
    .instruction();
}

interface YieldMovementBaseInput {
  agentDid: Uint8Array;
  strategyId: Uint8Array;
  mint: PublicKey;
  receiptMint: PublicKey;
  kaminoProgram: PublicKey;
  routeData: Uint8Array;
  routeAccounts?: AccountMeta[];
  allowedTargets?: PublicKey | null;
  tokenProgramId?: PublicKey;
}

function assertYieldMovementInput(input: YieldMovementBaseInput) {
  if (input.agentDid.length !== 32) throw new Error('agentDid must be 32 bytes');
  if (input.strategyId.length !== 32) throw new Error('strategyId must be 32 bytes');
  if (input.routeData.length === 0) throw new Error('routeData is required');
  if (input.routeData.length > MAX_YIELD_ROUTE_DATA_LEN) {
    throw new Error(`routeData exceeds ${MAX_YIELD_ROUTE_DATA_LEN} bytes`);
  }
}

function yieldMovementPdas(programId: PublicKey, input: YieldMovementBaseInput) {
  const [global] = treasuryGlobalPda(programId);
  const [allowedMints] = treasuryAllowedMintsPda(programId);
  const [treasury] = treasuryPda(programId, input.agentDid);
  const [strategy] = treasuryYieldStrategyPda(programId, input.strategyId);
  const [yieldConfig] = treasuryYieldConfigPda(programId, input.agentDid);
  const [position] = treasuryYieldPositionPda(programId, input.agentDid, input.strategyId, input.mint);
  const [vault] = vaultPda(programId, input.agentDid, input.mint);
  const [receiptVault] = treasuryYieldReceiptVaultPda(programId, position);
  const [guard] = reentrancyGuardPda(programId);
  return { global, allowedMints, treasury, strategy, yieldConfig, position, vault, receiptVault, guard };
}

export interface DepositToYieldStrategyInput extends YieldMovementBaseInput {
  operator: PublicKey;
  amount: bigint;
  priceFeed?: PublicKey | null;
}

export async function buildDepositToYieldStrategyIx(
  program: Program<TreasuryStandard>,
  input: DepositToYieldStrategyInput,
): Promise<TransactionInstruction> {
  assertYieldMovementInput(input);
  if (input.amount <= 0n) throw new Error('amount must be greater than zero');
  const pdas = yieldMovementPdas(program.programId, input);

  return program.methods
    .depositToYieldStrategy(new BN(input.amount.toString()), Buffer.from(input.routeData))
    .accounts({
      global: pdas.global,
      treasury: pdas.treasury,
      allowedMints: pdas.allowedMints,
      allowedTargets: input.allowedTargets ?? null,
      strategy: pdas.strategy,
      yieldConfig: pdas.yieldConfig,
      position: pdas.position,
      mint: input.mint,
      receiptMint: input.receiptMint,
      vault: pdas.vault,
      receiptVault: pdas.receiptVault,
      kaminoProgram: input.kaminoProgram,
      priceFeed: input.priceFeed ?? null,
      guard: pdas.guard,
      operator: input.operator,
      tokenProgram: input.tokenProgramId ?? TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT,
    } as never)
    .remainingAccounts(input.routeAccounts ?? [])
    .instruction();
}

export interface WithdrawFromYieldStrategyInput extends YieldMovementBaseInput {
  operator: PublicKey;
  receiptAmount: bigint;
}

export async function buildWithdrawFromYieldStrategyIx(
  program: Program<TreasuryStandard>,
  input: WithdrawFromYieldStrategyInput,
): Promise<TransactionInstruction> {
  assertYieldMovementInput(input);
  if (input.receiptAmount <= 0n) throw new Error('receiptAmount must be greater than zero');
  const pdas = yieldMovementPdas(program.programId, input);

  return program.methods
    .withdrawFromYieldStrategy(new BN(input.receiptAmount.toString()), Buffer.from(input.routeData))
    .accounts({
      global: pdas.global,
      treasury: pdas.treasury,
      allowedTargets: input.allowedTargets ?? null,
      strategy: pdas.strategy,
      yieldConfig: pdas.yieldConfig,
      position: pdas.position,
      mint: input.mint,
      receiptMint: input.receiptMint,
      vault: pdas.vault,
      receiptVault: pdas.receiptVault,
      kaminoProgram: input.kaminoProgram,
      guard: pdas.guard,
      operator: input.operator,
      tokenProgram: input.tokenProgramId ?? TOKEN_2022_PROGRAM_ID,
    } as never)
    .remainingAccounts(input.routeAccounts ?? [])
    .instruction();
}

export interface EmergencyUnwindYieldStrategyInput extends YieldMovementBaseInput {
  authority: PublicKey;
}

export async function buildEmergencyUnwindYieldStrategyIx(
  program: Program<TreasuryStandard>,
  input: EmergencyUnwindYieldStrategyInput,
): Promise<TransactionInstruction> {
  assertYieldMovementInput(input);
  const pdas = yieldMovementPdas(program.programId, input);

  return program.methods
    .emergencyUnwindYieldStrategy(Buffer.from(input.routeData))
    .accounts({
      global: pdas.global,
      treasury: pdas.treasury,
      allowedTargets: input.allowedTargets ?? null,
      strategy: pdas.strategy,
      yieldConfig: pdas.yieldConfig,
      position: pdas.position,
      mint: input.mint,
      receiptMint: input.receiptMint,
      vault: pdas.vault,
      receiptVault: pdas.receiptVault,
      kaminoProgram: input.kaminoProgram,
      guard: pdas.guard,
      authority: input.authority,
      tokenProgram: input.tokenProgramId ?? TOKEN_2022_PROGRAM_ID,
    } as never)
    .remainingAccounts(input.routeAccounts ?? [])
    .instruction();
}
