import { PublicKey } from '@solana/web3.js';

const enc = (s: string) => new TextEncoder().encode(s);

export function agentRegistryGlobalPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('global')], programId);
}

export function agentAccountPda(
  programId: PublicKey,
  operator: PublicKey,
  agentId: Uint8Array,
): [PublicKey, number] {
  if (agentId.length !== 32) throw new Error('agentId must be 32 bytes');
  return PublicKey.findProgramAddressSync(
    [enc('agent'), operator.toBuffer(), agentId],
    programId,
  );
}

export function agentStakePda(programId: PublicKey, agent: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('stake'), agent.toBuffer()], programId);
}

export function treasuryGlobalPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('treasury_global')], programId);
}

export function treasuryAllowedMintsPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('allowed_mints')], programId);
}

export function treasuryPda(programId: PublicKey, agentDid: Uint8Array): [PublicKey, number] {
  if (agentDid.length !== 32) throw new Error('agentDid must be 32 bytes');
  return PublicKey.findProgramAddressSync([enc('treasury'), agentDid], programId);
}

export function vaultPda(
  programId: PublicKey,
  agentDid: Uint8Array,
  mint: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [enc('vault'), agentDid, mint.toBuffer()],
    programId,
  );
}
