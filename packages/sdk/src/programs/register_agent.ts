import { BN, Program } from '@coral-xyz/anchor';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import type { AgentRegistry } from '../generated/agent_registry.js';
import { agentAccountPda, agentRegistryGlobalPda, agentStakePda } from '../pda/index.js';

export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const CAPABILITY_CONFIG_SEED = 'config';

export const MANIFEST_URI_LEN = 128;
export const AGENT_ID_LEN = 32;

export interface RegisterAgentInput {
  operator: PublicKey;
  agentId: Uint8Array;
  manifestUri: string;
  capabilityMask: bigint;
  priceLamports: bigint;
  streamRate: bigint;
  stakeAmount: bigint;
  stakeMint: PublicKey;
  operatorTokenAccount: PublicKey;
  capabilityRegistryProgramId: PublicKey;
}

export function encodeAgentId(seed: string): Uint8Array {
  const buf = new Uint8Array(AGENT_ID_LEN);
  const bytes = new TextEncoder().encode(seed);
  if (bytes.length > AGENT_ID_LEN) {
    throw new Error(`agentId seed exceeds ${AGENT_ID_LEN} bytes`);
  }
  buf.set(bytes);
  return buf;
}

export function encodeManifestUri(uri: string): Uint8Array {
  const buf = new Uint8Array(MANIFEST_URI_LEN);
  const bytes = new TextEncoder().encode(uri);
  if (bytes.length > MANIFEST_URI_LEN) {
    throw new Error(`manifestUri exceeds ${MANIFEST_URI_LEN} bytes`);
  }
  buf.set(bytes);
  return buf;
}

function capabilityConfigPda(capabilityRegistry: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode(CAPABILITY_CONFIG_SEED)],
    capabilityRegistry,
  );
  return pda;
}

export async function buildRegisterAgentIx(
  program: Program<AgentRegistry>,
  input: RegisterAgentInput,
): Promise<TransactionInstruction> {
  const [global] = agentRegistryGlobalPda(program.programId);
  const [agent] = agentAccountPda(program.programId, input.operator, input.agentId);
  const [stakeVault] = agentStakePda(program.programId, agent);
  const capabilityConfig = capabilityConfigPda(input.capabilityRegistryProgramId);

  const manifestBytes = encodeManifestUri(input.manifestUri);

  return program.methods
    .registerAgent(
      Array.from(input.agentId),
      Array.from(manifestBytes),
      new BN(input.capabilityMask.toString()),
      new BN(input.priceLamports.toString()),
      new BN(input.streamRate.toString()),
      new BN(input.stakeAmount.toString()),
    )
    .accounts({
      global,
      capabilityConfig,
      agent,
      stakeMint: input.stakeMint,
      stakeVault,
      operatorTokenAccount: input.operatorTokenAccount,
      operator: input.operator,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    } as never)
    .instruction();
}
