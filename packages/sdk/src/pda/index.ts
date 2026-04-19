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

export function categoryReputationPda(
  programId: PublicKey,
  agentDid: Uint8Array,
  capabilityBit: number,
): [PublicKey, number] {
  if (agentDid.length !== 32) throw new Error('agentDid must be 32 bytes');
  if (!Number.isInteger(capabilityBit) || capabilityBit < 0 || capabilityBit > 127) {
    throw new Error('capabilityBit must be an integer in 0..=127');
  }
  const bitBytes = new Uint8Array(2);
  bitBytes[0] = capabilityBit & 0xff;
  bitBytes[1] = (capabilityBit >> 8) & 0xff;
  return PublicKey.findProgramAddressSync([enc('rep'), agentDid, bitBytes], programId);
}

export function proofVerifierRepAuthorityPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('rep_authority')], programId);
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

// task_market PDAs

export function marketGlobalPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('market_global')], programId);
}

export function taskPda(
  programId: PublicKey,
  client: PublicKey,
  taskNonce: Uint8Array,
): [PublicKey, number] {
  if (taskNonce.length !== 8) throw new Error('taskNonce must be 8 bytes');
  return PublicKey.findProgramAddressSync(
    [enc('task'), client.toBuffer(), taskNonce],
    programId,
  );
}

export function taskEscrowPda(programId: PublicKey, task: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('task_escrow'), task.toBuffer()], programId);
}

export function bidBookPda(programId: PublicKey, taskId: Uint8Array): [PublicKey, number] {
  if (taskId.length !== 32) throw new Error('taskId must be 32 bytes');
  return PublicKey.findProgramAddressSync([enc('bid_book'), taskId], programId);
}

export function bondEscrowPda(programId: PublicKey, taskId: Uint8Array): [PublicKey, number] {
  if (taskId.length !== 32) throw new Error('taskId must be 32 bytes');
  return PublicKey.findProgramAddressSync([enc('bond_escrow'), taskId], programId);
}

export function bidPda(
  programId: PublicKey,
  taskId: Uint8Array,
  bidder: PublicKey,
): [PublicKey, number] {
  if (taskId.length !== 32) throw new Error('taskId must be 32 bytes');
  return PublicKey.findProgramAddressSync(
    [enc('bid'), taskId, bidder.toBuffer()],
    programId,
  );
}

// proof_verifier PDAs

export function verifierConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('verifier_config')], programId);
}

export function verifierKeyPda(programId: PublicKey, vkId: Uint8Array): [PublicKey, number] {
  if (vkId.length !== 32) throw new Error('vkId must be 32 bytes');
  return PublicKey.findProgramAddressSync([enc('vk'), vkId], programId);
}

export function verifierModePda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('mode')], programId);
}

export function batchStatePda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('batch')], programId);
}

export function proofVerifierGuardPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('guard')], programId);
}

export function proofVerifierAllowedCallersPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('allowed_callers')], programId);
}

// capability_registry PDAs

export function capabilityConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('config')], programId);
}

export function streamPda(
  programId: PublicKey,
  agentDid: Uint8Array,
  client: PublicKey,
  streamNonce: Uint8Array,
): [PublicKey, number] {
  if (agentDid.length !== 32) throw new Error('agentDid must be 32 bytes');
  if (streamNonce.length !== 8) throw new Error('streamNonce must be 8 bytes');
  return PublicKey.findProgramAddressSync(
    [enc('stream'), agentDid, client.toBuffer(), streamNonce],
    programId,
  );
}

export function streamEscrowPda(programId: PublicKey, stream: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('stream_escrow'), stream.toBuffer()], programId);
}

// dispute_arbitration PDAs

export function disputeConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('dispute_config')], programId);
}

export function disputePoolPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('dispute_pool')], programId);
}

export function disputeCasePda(programId: PublicKey, caseId: bigint): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(caseId);
  return PublicKey.findProgramAddressSync([enc('dispute_case'), buf], programId);
}

export function arbitratorPda(programId: PublicKey, operator: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('arbitrator'), operator.toBuffer()], programId);
}

export function disputeVotePda(
  programId: PublicKey,
  caseId: bigint,
  arbitrator: PublicKey,
): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(caseId);
  return PublicKey.findProgramAddressSync(
    [enc('dispute_vote'), buf, arbitrator.toBuffer()],
    programId,
  );
}

export function appealPda(programId: PublicKey, caseId: bigint): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(caseId);
  return PublicKey.findProgramAddressSync([enc('appeal'), buf], programId);
}

export function pendingSlashPda(programId: PublicKey, operator: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('pending_slash'), operator.toBuffer()], programId);
}

// governance_program PDAs

export function govConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('governance_config')], programId);
}

export function programRegistryPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('program_registry')], programId);
}

export function proposalPda(programId: PublicKey, proposalId: bigint): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(proposalId);
  return PublicKey.findProgramAddressSync([enc('proposal'), buf], programId);
}

export function govVoteRecordPda(
  programId: PublicKey,
  proposal: PublicKey,
  voter: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [enc('vote'), proposal.toBuffer(), voter.toBuffer()],
    programId,
  );
}

export function executionRecordPda(programId: PublicKey, proposal: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('execution'), proposal.toBuffer()], programId);
}

// fee_collector PDAs

export function feeConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('fee_config')], programId);
}

export function epochPda(programId: PublicKey, epochId: bigint): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(epochId);
  return PublicKey.findProgramAddressSync([enc('epoch'), buf], programId);
}

export function claimPda(
  programId: PublicKey,
  epochId: bigint,
  staker: PublicKey,
): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(epochId);
  return PublicKey.findProgramAddressSync(
    [enc('claim'), buf, staker.toBuffer()],
    programId,
  );
}

export function intakeVaultPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('intake_vault')], programId);
}

export function burnVaultPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('burn_vault')], programId);
}

export function stakerVaultPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('staker_vault')], programId);
}

// nxs_staking PDAs

export function stakingPoolPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('staking_pool')], programId);
}

export function stakeAccountPda(
  programId: PublicKey,
  pool: PublicKey,
  owner: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [enc('stake'), pool.toBuffer(), owner.toBuffer()],
    programId,
  );
}

export function stakeVaultPda(programId: PublicKey, stakeAccount: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('stake_vault'), stakeAccount.toBuffer()], programId);
}

// template_registry PDAs

export function templateGlobalPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('tpl_global')], programId);
}

export function templatePda(programId: PublicKey, templateId: Uint8Array): [PublicKey, number] {
  if (templateId.length !== 32) throw new Error('templateId must be 32 bytes');
  return PublicKey.findProgramAddressSync([enc('template'), templateId], programId);
}

export function rentalPda(
  programId: PublicKey,
  template: PublicKey,
  renter: PublicKey,
  rentalNonce: Uint8Array,
): [PublicKey, number] {
  if (rentalNonce.length !== 8) throw new Error('rentalNonce must be 8 bytes');
  return PublicKey.findProgramAddressSync(
    [enc('rental'), template.toBuffer(), renter.toBuffer(), rentalNonce],
    programId,
  );
}

export function rentalEscrowPda(programId: PublicKey, rental: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('rental_escrow'), rental.toBuffer()], programId);
}

export function forkPda(programId: PublicKey, childAgentDid: Uint8Array): [PublicKey, number] {
  if (childAgentDid.length !== 32) throw new Error('childAgentDid must be 32 bytes');
  return PublicKey.findProgramAddressSync([enc('fork'), childAgentDid], programId);
}
