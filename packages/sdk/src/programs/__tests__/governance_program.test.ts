import { describe, it, expect } from 'vitest';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import idl from '../../idl/governance_program.json' with { type: 'json' };
import type { GovernanceProgram } from '../../generated/governance_program.js';
import { govConfigPda, programRegistryPda, govVoteRecordPda, executionRecordPda } from '../../pda/index.js';
import {
  buildProposeIx,
  buildVoteIx,
  buildFinalizeVoteIx,
  buildExecuteProposalIx,
  buildExpireProposalIx,
  buildProposerCancelIx,
  buildQueueExecutionIx,
} from '../governance_program.js';
import { makeTestProgram, decodeIx, expectedDiscriminator, accountKeys } from './helpers.js';

const PROG = new PublicKey('9uczLDZaN9EWqW76be75ji4vCsz3cydefbChqvBS6qw1');

const program = makeTestProgram<GovernanceProgram>(idl as Record<string, unknown>, PROG);

const proposer = PublicKey.unique();
const proposal = PublicKey.unique();
const voter = PublicKey.unique();
const cranker = PublicKey.unique();
const executor = PublicKey.unique();

describe('buildProposeIx', () => {
  const ixData = new Uint8Array(64).fill(0xaa);
  const metadataUri = new Uint8Array(96).fill(0xbb);
  const snapshotRoot = new Uint8Array(32).fill(0xcc);

  it('returns ix with correct programId, discriminator, accounts', async () => {
    const ix = await buildProposeIx(program, {
      proposer,
      proposal,
      category: { parameterChange: {} } as never,
      targetProgram: PublicKey.unique(),
      ixData,
      metadataUri,
      snapshot: { totalEligibleWeight: 1000n, snapshotSlot: 42n, snapshotRoot },
    });
    expect(ix.programId.equals(PROG)).toBe(true);
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'propose'));
    const [config] = govConfigPda(PROG);
    const [registry] = programRegistryPda(PROG);
    expect(accountKeys(ix)).toEqual([
      config.toBase58(),
      registry.toBase58(),
      proposal.toBase58(),
      proposer.toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
    expect(ix.keys[3].isSigner).toBe(true);
  });

  it('round-trips args via BorshInstructionCoder', async () => {
    const targetProgram = PublicKey.unique();
    const ix = await buildProposeIx(program, {
      proposer,
      proposal,
      category: { parameterChange: {} } as never,
      targetProgram,
      ixData,
      metadataUri,
      snapshot: { totalEligibleWeight: 5000n, snapshotSlot: 100n, snapshotRoot },
    });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('propose');
    const data = decoded.data as Record<string, unknown>;
    expect(Array.from(data.ix_data as Uint8Array)).toEqual(Array.from(ixData));
    expect(Array.from(data.metadata_uri as Uint8Array)).toEqual(Array.from(metadataUri));
    expect((data.target_program as PublicKey).toBase58()).toBe(targetProgram.toBase58());
  });
});

describe('buildVoteIx', () => {
  const proof = [new Uint8Array(32).fill(0x01), new Uint8Array(32).fill(0x02)];

  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildVoteIx(program, {
      proposal,
      voter,
      choice: { for: {} } as never,
      weight: 100n,
      merkleProof: proof,
    });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'vote'));
    const [config] = govConfigPda(PROG);
    const [voteRecord] = govVoteRecordPda(PROG, proposal, voter);
    expect(accountKeys(ix)).toEqual([
      config.toBase58(),
      proposal.toBase58(),
      voteRecord.toBase58(),
      voter.toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
    expect(ix.keys[3].isSigner).toBe(true);
  });

  it('round-trips weight', async () => {
    const ix = await buildVoteIx(program, {
      proposal,
      voter,
      choice: { for: {} } as never,
      weight: 999999n,
      merkleProof: proof,
    });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('vote');
    const data = decoded.data as { weight: { toString(): string } };
    expect(data.weight.toString()).toBe('999999');
  });
});

describe('buildFinalizeVoteIx', () => {
  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildFinalizeVoteIx(program, { proposal, cranker });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'finalize_vote'));
    const [config] = govConfigPda(PROG);
    const [registry] = programRegistryPda(PROG);
    expect(accountKeys(ix)).toEqual([
      config.toBase58(),
      registry.toBase58(),
      proposal.toBase58(),
      cranker.toBase58(),
    ]);
    expect(ix.keys[3].isSigner).toBe(true);
  });
});

describe('buildExecuteProposalIx', () => {
  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildExecuteProposalIx(program, { proposal, executor });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'execute_proposal'));
    const [config] = govConfigPda(PROG);
    const [registry] = programRegistryPda(PROG);
    const [execRecord] = executionRecordPda(PROG, proposal);
    expect(accountKeys(ix)).toEqual([
      config.toBase58(),
      registry.toBase58(),
      proposal.toBase58(),
      execRecord.toBase58(),
      executor.toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
    expect(ix.keys[4].isSigner).toBe(true);
  });
});

describe('buildExpireProposalIx', () => {
  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildExpireProposalIx(program, { proposal, cranker });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'expire_proposal'));
    expect(accountKeys(ix)).toEqual([proposal.toBase58(), cranker.toBase58()]);
    expect(ix.keys[1].isSigner).toBe(true);
  });
});

describe('buildProposerCancelIx', () => {
  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildProposerCancelIx(program, { proposal, proposer });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'proposer_cancel'));
    expect(accountKeys(ix)).toEqual([proposal.toBase58(), proposer.toBase58()]);
    expect(ix.keys[1].isSigner).toBe(true);
  });
});

describe('buildQueueExecutionIx', () => {
  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildQueueExecutionIx(program, { proposal, cranker });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'queue_execution'));
    expect(accountKeys(ix)).toEqual([proposal.toBase58(), cranker.toBase58()]);
    expect(ix.keys[1].isSigner).toBe(true);
  });
});
