import { describe, it, expect } from 'vitest';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import idl from '../../idl/fee_collector.json' with { type: 'json' };
import type { FeeCollector } from '../../generated/fee_collector.js';
import {
  feeConfigPda,
  epochPda,
  claimPda,
  intakeVaultPda,
  burnVaultPda,
  stakerVaultPda,
} from '../../pda/index.js';
import {
  buildClaimStakerIx,
  buildProcessEpochIx,
  buildExecuteBurnIx,
} from '../fee_collector.js';
import { makeTestProgram, decodeIx, expectedDiscriminator, accountKeys } from './helpers.js';

const PROG = new PublicKey('4xLpFgjpZwJbf61UyvyMhmEBmeJzPaCyKvZeYuK2YFFu');
const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

const program = makeTestProgram<FeeCollector>(idl as Record<string, unknown>, PROG);

const staker = PublicKey.unique();
const cranker = PublicKey.unique();
const saepMint = PublicKey.unique();
const stakerTokenAccount = PublicKey.unique();
const grantRecipient = PublicKey.unique();
const treasuryRecipient = PublicKey.unique();

describe('buildClaimStakerIx', () => {
  const baseClaim = {
    staker,
    saepMint,
    stakerTokenAccount,
    epochId: 7n,
    amount: 1_000_000n,
    merkleProof: [new Uint8Array(32).fill(0x01), new Uint8Array(32).fill(0x02)],
    tokenProgram: TOKEN_2022,
  };

  it('returns ix with correct programId + discriminator', async () => {
    const ix = await buildClaimStakerIx(program, baseClaim);
    expect(ix.programId.equals(PROG)).toBe(true);
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'claim_staker'));
  });

  it('derives config + epoch + claim + stakerVault PDAs from epochId/staker', async () => {
    const ix = await buildClaimStakerIx(program, baseClaim);
    const [config] = feeConfigPda(PROG);
    const [epoch] = epochPda(PROG, baseClaim.epochId);
    const [claim] = claimPda(PROG, baseClaim.epochId, staker);
    const [stakerVault] = stakerVaultPda(PROG);
    const keys = accountKeys(ix);
    expect(keys).toContain(config.toBase58());
    expect(keys).toContain(epoch.toBase58());
    expect(keys).toContain(claim.toBase58());
    expect(keys).toContain(stakerVault.toBase58());
    expect(keys).toContain(SystemProgram.programId.toBase58());
  });

  it('marks staker as signer + writable', async () => {
    const ix = await buildClaimStakerIx(program, baseClaim);
    const stakerEntry = ix.keys.find((k) => k.pubkey.equals(staker));
    expect(stakerEntry?.isSigner).toBe(true);
    expect(stakerEntry?.isWritable).toBe(true);
  });

  it('round-trips epoch_id, amount, and merkle_proof', async () => {
    const ix = await buildClaimStakerIx(program, baseClaim);
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('claim_staker');
    const data = decoded.data as {
      epoch_id: { toString(): string };
      amount: { toString(): string };
      merkle_proof: number[][];
    };
    expect(data.epoch_id.toString()).toBe('7');
    expect(data.amount.toString()).toBe('1000000');
    expect(data.merkle_proof).toHaveLength(2);
    expect(data.merkle_proof[0][0]).toBe(0x01);
    expect(data.merkle_proof[1][31]).toBe(0x02);
  });

  it('encodes empty merkle_proof', async () => {
    const ix = await buildClaimStakerIx(program, { ...baseClaim, merkleProof: [] });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect((decoded.data as { merkle_proof: number[][] }).merkle_proof).toHaveLength(0);
  });
});

describe('buildProcessEpochIx', () => {
  const baseProcess = {
    cranker,
    saepMint,
    grantRecipient,
    treasuryRecipient,
    currentEpochId: 5n,
    nextEpochId: 6n,
    snapshotId: 42n,
    tokenProgram: TOKEN_2022,
  };

  it('returns ix with correct programId + discriminator', async () => {
    const ix = await buildProcessEpochIx(program, baseProcess);
    expect(ix.programId.equals(PROG)).toBe(true);
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'process_epoch'));
  });

  it('derives 6 PDAs from program + epoch ids', async () => {
    const ix = await buildProcessEpochIx(program, baseProcess);
    const [config] = feeConfigPda(PROG);
    const [currentEpoch] = epochPda(PROG, baseProcess.currentEpochId);
    const [nextEpoch] = epochPda(PROG, baseProcess.nextEpochId);
    const [intakeVault] = intakeVaultPda(PROG);
    const [burnVault] = burnVaultPda(PROG);
    const [stakerVault] = stakerVaultPda(PROG);
    const keys = accountKeys(ix);
    [config, currentEpoch, nextEpoch, intakeVault, burnVault, stakerVault].forEach((pk) => {
      expect(keys).toContain(pk.toBase58());
    });
  });

  it('marks cranker as signer', async () => {
    const ix = await buildProcessEpochIx(program, baseProcess);
    const crankerEntry = ix.keys.find((k) => k.pubkey.equals(cranker));
    expect(crankerEntry?.isSigner).toBe(true);
  });

  it('round-trips snapshot_id', async () => {
    const snapshotId = 0xcafebabedeadn;
    const ix = await buildProcessEpochIx(program, { ...baseProcess, snapshotId });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('process_epoch');
    expect(
      (decoded.data as { snapshot_id: { toString(): string } }).snapshot_id.toString(),
    ).toBe(snapshotId.toString());
  });
});

describe('buildExecuteBurnIx', () => {
  const baseBurn = {
    cranker,
    saepMint,
    epochId: 9n,
    tokenProgram: TOKEN_2022,
  };

  it('returns ix with correct programId + discriminator', async () => {
    const ix = await buildExecuteBurnIx(program, baseBurn);
    expect(ix.programId.equals(PROG)).toBe(true);
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'execute_burn'));
  });

  it('derives config + epoch + burnVault PDAs', async () => {
    const ix = await buildExecuteBurnIx(program, baseBurn);
    const [config] = feeConfigPda(PROG);
    const [epoch] = epochPda(PROG, baseBurn.epochId);
    const [burnVault] = burnVaultPda(PROG);
    const keys = accountKeys(ix);
    expect(keys).toContain(config.toBase58());
    expect(keys).toContain(epoch.toBase58());
    expect(keys).toContain(burnVault.toBase58());
    expect(keys).toContain(saepMint.toBase58());
    expect(keys).toContain(TOKEN_2022.toBase58());
  });

  it('round-trips epoch_id', async () => {
    const ix = await buildExecuteBurnIx(program, { ...baseBurn, epochId: 12345n });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('execute_burn');
    expect(
      (decoded.data as { epoch_id: { toString(): string } }).epoch_id.toString(),
    ).toBe('12345');
  });
});
