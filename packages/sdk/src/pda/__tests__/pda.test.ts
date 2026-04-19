import { describe, it, expect } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import {
  agentRegistryGlobalPda,
  agentAccountPda,
  agentStakePda,
  categoryReputationPda,
  proofVerifierRepAuthorityPda,
  treasuryGlobalPda,
  treasuryAllowedMintsPda,
  treasuryPda,
  vaultPda,
  marketGlobalPda,
  taskPda,
  taskEscrowPda,
  bidBookPda,
  bondEscrowPda,
  bidPda,
  verifierConfigPda,
  verifierKeyPda,
  verifierModePda,
  batchStatePda,
  capabilityConfigPda,
  streamPda,
  streamEscrowPda,
  disputeConfigPda,
  disputePoolPda,
  disputeCasePda,
  arbitratorPda,
  disputeVotePda,
  appealPda,
  pendingSlashPda,
  govConfigPda,
  programRegistryPda,
  proposalPda,
  govVoteRecordPda,
  executionRecordPda,
  feeConfigPda,
  epochPda,
  claimPda,
  intakeVaultPda,
  burnVaultPda,
  stakerVaultPda,
  stakingPoolPda,
  stakeAccountPda,
  stakeVaultPda,
  templateGlobalPda,
  templatePda,
  rentalPda,
  rentalEscrowPda,
  forkPda,
} from '../index.js';

const PROG = new PublicKey('11111111111111111111111111111112');
const KEY_A = PublicKey.unique();
const KEY_B = PublicKey.unique();
const DID_32 = new Uint8Array(32).fill(0xab);
const ID_32 = new Uint8Array(32).fill(0xcd);
const NONCE_8 = new Uint8Array(8).fill(0x01);

function assertValidPda(result: [PublicKey, number]) {
  expect(result).toHaveLength(2);
  expect(result[0]).toBeInstanceOf(PublicKey);
  expect(typeof result[1]).toBe('number');
  expect(result[1]).toBeGreaterThanOrEqual(0);
  expect(result[1]).toBeLessThanOrEqual(255);
}

function assertDeterministic(fn: () => [PublicKey, number]) {
  const [a] = fn();
  const [b] = fn();
  expect(a.equals(b)).toBe(true);
}

describe('AgentRegistry PDAs', () => {
  it('agentRegistryGlobalPda', () => {
    assertValidPda(agentRegistryGlobalPda(PROG));
    assertDeterministic(() => agentRegistryGlobalPda(PROG));
  });

  it('agentAccountPda', () => {
    assertValidPda(agentAccountPda(PROG, KEY_A, ID_32));
    assertDeterministic(() => agentAccountPda(PROG, KEY_A, ID_32));
  });

  it('agentAccountPda varies by operator', () => {
    const [a] = agentAccountPda(PROG, KEY_A, ID_32);
    const [b] = agentAccountPda(PROG, KEY_B, ID_32);
    expect(a.equals(b)).toBe(false);
  });

  it('agentAccountPda rejects wrong-length agentId', () => {
    expect(() => agentAccountPda(PROG, KEY_A, new Uint8Array(16))).toThrow('agentId must be 32 bytes');
  });

  it('agentStakePda', () => {
    assertValidPda(agentStakePda(PROG, KEY_A));
    assertDeterministic(() => agentStakePda(PROG, KEY_A));
  });

  it('categoryReputationPda', () => {
    assertValidPda(categoryReputationPda(PROG, DID_32, 5));
    assertDeterministic(() => categoryReputationPda(PROG, DID_32, 5));
  });

  it('categoryReputationPda varies by bit', () => {
    const [a] = categoryReputationPda(PROG, DID_32, 0);
    const [b] = categoryReputationPda(PROG, DID_32, 1);
    expect(a.equals(b)).toBe(false);
  });

  it('categoryReputationPda rejects invalid bit', () => {
    expect(() => categoryReputationPda(PROG, DID_32, -1)).toThrow('capabilityBit must be');
    expect(() => categoryReputationPda(PROG, DID_32, 128)).toThrow('capabilityBit must be');
    expect(() => categoryReputationPda(PROG, DID_32, 1.5)).toThrow('capabilityBit must be');
  });

  it('categoryReputationPda rejects wrong-length DID', () => {
    expect(() => categoryReputationPda(PROG, new Uint8Array(16), 0)).toThrow('agentDid must be 32 bytes');
  });

  it('proofVerifierRepAuthorityPda', () => {
    assertValidPda(proofVerifierRepAuthorityPda(PROG));
  });
});

describe('TreasuryStandard PDAs', () => {
  it('treasuryGlobalPda', () => {
    assertValidPda(treasuryGlobalPda(PROG));
  });

  it('treasuryAllowedMintsPda', () => {
    assertValidPda(treasuryAllowedMintsPda(PROG));
  });

  it('treasuryPda', () => {
    assertValidPda(treasuryPda(PROG, DID_32));
  });

  it('treasuryPda rejects wrong-length DID', () => {
    expect(() => treasuryPda(PROG, new Uint8Array(10))).toThrow('agentDid must be 32 bytes');
  });

  it('vaultPda varies by mint', () => {
    const [a] = vaultPda(PROG, DID_32, KEY_A);
    const [b] = vaultPda(PROG, DID_32, KEY_B);
    expect(a.equals(b)).toBe(false);
  });
});

describe('TaskMarket PDAs', () => {
  it('marketGlobalPda', () => {
    assertValidPda(marketGlobalPda(PROG));
  });

  it('taskPda', () => {
    assertValidPda(taskPda(PROG, KEY_A, NONCE_8));
    assertDeterministic(() => taskPda(PROG, KEY_A, NONCE_8));
  });

  it('taskPda rejects wrong-length nonce', () => {
    expect(() => taskPda(PROG, KEY_A, new Uint8Array(4))).toThrow('taskNonce must be 8 bytes');
  });

  it('taskPda varies by client', () => {
    const [a] = taskPda(PROG, KEY_A, NONCE_8);
    const [b] = taskPda(PROG, KEY_B, NONCE_8);
    expect(a.equals(b)).toBe(false);
  });

  it('taskEscrowPda', () => {
    assertValidPda(taskEscrowPda(PROG, KEY_A));
  });

  it('bidBookPda', () => {
    assertValidPda(bidBookPda(PROG, ID_32));
  });

  it('bidBookPda rejects wrong-length taskId', () => {
    expect(() => bidBookPda(PROG, new Uint8Array(16))).toThrow('taskId must be 32 bytes');
  });

  it('bondEscrowPda', () => {
    assertValidPda(bondEscrowPda(PROG, ID_32));
  });

  it('bidPda varies by bidder', () => {
    const [a] = bidPda(PROG, ID_32, KEY_A);
    const [b] = bidPda(PROG, ID_32, KEY_B);
    expect(a.equals(b)).toBe(false);
  });
});

describe('ProofVerifier PDAs', () => {
  it('verifierConfigPda', () => {
    assertValidPda(verifierConfigPda(PROG));
  });

  it('verifierKeyPda', () => {
    assertValidPda(verifierKeyPda(PROG, ID_32));
  });

  it('verifierKeyPda rejects wrong-length vkId', () => {
    expect(() => verifierKeyPda(PROG, new Uint8Array(8))).toThrow('vkId must be 32 bytes');
  });

  it('verifierModePda', () => {
    assertValidPda(verifierModePda(PROG));
  });

  it('batchStatePda', () => {
    assertValidPda(batchStatePda(PROG));
  });
});

describe('CapabilityRegistry PDAs', () => {
  it('capabilityConfigPda', () => {
    assertValidPda(capabilityConfigPda(PROG));
  });

  it('streamPda', () => {
    assertValidPda(streamPda(PROG, DID_32, KEY_A, NONCE_8));
  });

  it('streamPda rejects wrong-length DID', () => {
    expect(() => streamPda(PROG, new Uint8Array(10), KEY_A, NONCE_8)).toThrow('agentDid must be 32 bytes');
  });

  it('streamPda rejects wrong-length nonce', () => {
    expect(() => streamPda(PROG, DID_32, KEY_A, new Uint8Array(4))).toThrow('streamNonce must be 8 bytes');
  });

  it('streamEscrowPda', () => {
    assertValidPda(streamEscrowPda(PROG, KEY_A));
  });
});

describe('DisputeArbitration PDAs', () => {
  it('disputeConfigPda', () => {
    assertValidPda(disputeConfigPda(PROG));
  });

  it('disputePoolPda', () => {
    assertValidPda(disputePoolPda(PROG));
  });

  it('disputeCasePda varies by caseId', () => {
    const [a] = disputeCasePda(PROG, 0n);
    const [b] = disputeCasePda(PROG, 1n);
    expect(a.equals(b)).toBe(false);
  });

  it('arbitratorPda', () => {
    assertValidPda(arbitratorPda(PROG, KEY_A));
  });

  it('disputeVotePda', () => {
    assertValidPda(disputeVotePda(PROG, 42n, KEY_A));
  });

  it('appealPda', () => {
    assertValidPda(appealPda(PROG, 100n));
  });

  it('pendingSlashPda', () => {
    assertValidPda(pendingSlashPda(PROG, KEY_A));
  });
});

describe('GovernanceProgram PDAs', () => {
  it('govConfigPda', () => {
    assertValidPda(govConfigPda(PROG));
  });

  it('programRegistryPda', () => {
    assertValidPda(programRegistryPda(PROG));
  });

  it('proposalPda varies by proposalId', () => {
    const [a] = proposalPda(PROG, 0n);
    const [b] = proposalPda(PROG, 999n);
    expect(a.equals(b)).toBe(false);
  });

  it('govVoteRecordPda', () => {
    assertValidPda(govVoteRecordPda(PROG, KEY_A, KEY_B));
  });

  it('executionRecordPda', () => {
    assertValidPda(executionRecordPda(PROG, KEY_A));
  });
});

describe('FeeCollector PDAs', () => {
  it('feeConfigPda', () => {
    assertValidPda(feeConfigPda(PROG));
  });

  it('epochPda', () => {
    assertValidPda(epochPda(PROG, 7n));
  });

  it('claimPda', () => {
    assertValidPda(claimPda(PROG, 7n, KEY_A));
  });

  it('intakeVaultPda', () => {
    assertValidPda(intakeVaultPda(PROG));
  });

  it('burnVaultPda', () => {
    assertValidPda(burnVaultPda(PROG));
  });

  it('stakerVaultPda', () => {
    assertValidPda(stakerVaultPda(PROG));
  });
});

describe('NxsStaking PDAs', () => {
  it('stakingPoolPda', () => {
    assertValidPda(stakingPoolPda(PROG));
  });

  it('stakeAccountPda varies by owner', () => {
    const [a] = stakeAccountPda(PROG, KEY_A, KEY_A);
    const [b] = stakeAccountPda(PROG, KEY_A, KEY_B);
    expect(a.equals(b)).toBe(false);
  });

  it('stakeVaultPda', () => {
    assertValidPda(stakeVaultPda(PROG, KEY_A));
  });
});

describe('TemplateRegistry PDAs', () => {
  it('templateGlobalPda', () => {
    assertValidPda(templateGlobalPda(PROG));
  });

  it('templatePda', () => {
    assertValidPda(templatePda(PROG, ID_32));
  });

  it('templatePda rejects wrong-length templateId', () => {
    expect(() => templatePda(PROG, new Uint8Array(16))).toThrow('templateId must be 32 bytes');
  });

  it('rentalPda', () => {
    assertValidPda(rentalPda(PROG, KEY_A, KEY_B, NONCE_8));
  });

  it('rentalPda rejects wrong-length nonce', () => {
    expect(() => rentalPda(PROG, KEY_A, KEY_B, new Uint8Array(4))).toThrow('rentalNonce must be 8 bytes');
  });

  it('rentalEscrowPda', () => {
    assertValidPda(rentalEscrowPda(PROG, KEY_A));
  });

  it('forkPda', () => {
    assertValidPda(forkPda(PROG, DID_32));
  });

  it('forkPda rejects wrong-length DID', () => {
    expect(() => forkPda(PROG, new Uint8Array(16))).toThrow('childAgentDid must be 32 bytes');
  });
});
