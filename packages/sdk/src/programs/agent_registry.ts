import { BN, Program } from '@coral-xyz/anchor';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import type { AgentRegistry } from '../generated/agent_registry.js';
import { agentAccountPda, agentRegistryGlobalPda, agentStakePda, capabilityConfigPda } from '../pda/index.js';
import { TOKEN_2022_PROGRAM_ID, encodeManifestUri } from './register_agent.js';

export interface UpdateManifestInput {
  operator: PublicKey;
  agent: PublicKey;
  manifestUri: string;
  capabilityMask: bigint;
  priceLamports: bigint;
  streamRate: bigint;
  capabilityRegistryProgramId: PublicKey;
}

export async function buildUpdateManifestIx(
  program: Program<AgentRegistry>,
  input: UpdateManifestInput,
): Promise<TransactionInstruction> {
  const [global] = agentRegistryGlobalPda(program.programId);
  const [capConfig] = capabilityConfigPda(input.capabilityRegistryProgramId);
  const manifestBytes = encodeManifestUri(input.manifestUri);

  return program.methods
    .updateManifest(
      Array.from(manifestBytes),
      new BN(input.capabilityMask.toString()),
      new BN(input.priceLamports.toString()),
      new BN(input.streamRate.toString()),
    )
    .accounts({
      global,
      capabilityConfig: capConfig,
      agent: input.agent,
      operator: input.operator,
    } as never)
    .instruction();
}

export interface StakeIncreaseInput {
  operator: PublicKey;
  agent: PublicKey;
  stakeMint: PublicKey;
  operatorTokenAccount: PublicKey;
  amount: bigint;
}

export async function buildStakeIncreaseIx(
  program: Program<AgentRegistry>,
  input: StakeIncreaseInput,
): Promise<TransactionInstruction> {
  const [global] = agentRegistryGlobalPda(program.programId);
  const [stakeVault] = agentStakePda(program.programId, input.agent);

  return program.methods
    .stakeIncrease(new BN(input.amount.toString()))
    .accounts({
      global,
      agent: input.agent,
      stakeMint: input.stakeMint,
      stakeVault,
      operatorTokenAccount: input.operatorTokenAccount,
      operator: input.operator,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    } as never)
    .instruction();
}

export interface StakeWithdrawRequestInput {
  operator: PublicKey;
  agent: PublicKey;
  amount: bigint;
}

export async function buildRequestStakeWithdrawIx(
  program: Program<AgentRegistry>,
  input: StakeWithdrawRequestInput,
): Promise<TransactionInstruction> {
  const [global] = agentRegistryGlobalPda(program.programId);

  return program.methods
    .stakeWithdrawRequest(new BN(input.amount.toString()))
    .accounts({
      global,
      agent: input.agent,
      operator: input.operator,
    } as never)
    .instruction();
}

export interface StakeWithdrawExecuteInput {
  operator: PublicKey;
  agent: PublicKey;
  stakeMint: PublicKey;
  operatorTokenAccount: PublicKey;
}

export async function buildExecuteStakeWithdrawIx(
  program: Program<AgentRegistry>,
  input: StakeWithdrawExecuteInput,
): Promise<TransactionInstruction> {
  const [global] = agentRegistryGlobalPda(program.programId);
  const [stakeVault] = agentStakePda(program.programId, input.agent);

  return program.methods
    .stakeWithdrawExecute()
    .accounts({
      global,
      agent: input.agent,
      stakeMint: input.stakeMint,
      stakeVault,
      operatorTokenAccount: input.operatorTokenAccount,
      operator: input.operator,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    } as never)
    .instruction();
}

export interface SetStatusInput {
  operator: PublicKey;
  agent: PublicKey;
  newStatus: { active: Record<string, never> } | { paused: Record<string, never> } | { deregistered: Record<string, never> };
}

export async function buildDeregisterIx(
  program: Program<AgentRegistry>,
  input: { operator: PublicKey; agent: PublicKey },
): Promise<TransactionInstruction> {
  const [global] = agentRegistryGlobalPda(program.programId);

  return program.methods
    .setStatus({ deregistered: {} } as never)
    .accounts({
      global,
      agent: input.agent,
      signer: input.operator,
    } as never)
    .instruction();
}

export async function buildReactivateIx(
  program: Program<AgentRegistry>,
  input: { operator: PublicKey; agent: PublicKey },
): Promise<TransactionInstruction> {
  const [global] = agentRegistryGlobalPda(program.programId);

  return program.methods
    .setStatus({ active: {} } as never)
    .accounts({
      global,
      agent: input.agent,
      signer: input.operator,
    } as never)
    .instruction();
}
