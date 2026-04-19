import { describe, it, expect } from 'vitest';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import idl from '../../idl/nxs_staking.json' with { type: 'json' };
import type { NxsStaking } from '../../generated/nxs_staking.js';
import { stakingPoolPda, stakeAccountPda, stakeVaultPda } from '../../pda/index.js';
import { buildStakeIx, buildBeginUnstakeIx, buildStakeWithdrawIx } from '../nxs_staking.js';
import { makeTestProgram, decodeIx, expectedDiscriminator, accountKeys } from './helpers.js';

const PROG = new PublicKey('GjXfJ6MHb6SJ4XBK3qcpGw4n256qYPrDcXrNj6kf2i2Z');

const program = makeTestProgram<NxsStaking>(idl as Record<string, unknown>, PROG);

const owner = PublicKey.unique();
const stakeMint = PublicKey.unique();
const ownerTokenAccount = PublicKey.unique();
const tokenProgram = PublicKey.unique();

describe('buildStakeIx', () => {
  it('returns ix with correct programId, discriminator, accounts', async () => {
    const ix = await buildStakeIx(program, {
      owner,
      stakeMint,
      ownerTokenAccount,
      amount: 1000n,
      lockupDurationSecs: 86400n,
      tokenProgram,
    });
    expect(ix.programId.equals(PROG)).toBe(true);
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'stake'));
    const [pool] = stakingPoolPda(PROG);
    const [stakeAccount] = stakeAccountPda(PROG, pool, owner);
    const [vault] = stakeVaultPda(PROG, stakeAccount);
    expect(accountKeys(ix)).toEqual([
      pool.toBase58(),
      stakeAccount.toBase58(),
      stakeMint.toBase58(),
      vault.toBase58(),
      ownerTokenAccount.toBase58(),
      owner.toBase58(),
      tokenProgram.toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
    expect(ix.keys[5].isSigner).toBe(true);
    expect(ix.keys[1].isWritable).toBe(true);
  });

  it('round-trips args via BorshInstructionCoder', async () => {
    const ix = await buildStakeIx(program, {
      owner,
      stakeMint,
      ownerTokenAccount,
      amount: 5000n,
      lockupDurationSecs: 604800n,
      tokenProgram,
    });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('stake');
    const data = decoded.data as Record<string, { toString(): string }>;
    expect(data.amount.toString()).toBe('5000');
    expect(data.lockup_duration_secs.toString()).toBe('604800');
  });
});

describe('buildBeginUnstakeIx', () => {
  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildBeginUnstakeIx(program, { owner });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'begin_unstake'));
    const [pool] = stakingPoolPda(PROG);
    const [stakeAccount] = stakeAccountPda(PROG, pool, owner);
    expect(accountKeys(ix)).toEqual([
      pool.toBase58(),
      stakeAccount.toBase58(),
      owner.toBase58(),
    ]);
    expect(ix.keys[2].isSigner).toBe(true);
  });
});

describe('buildStakeWithdrawIx', () => {
  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildStakeWithdrawIx(program, {
      owner,
      stakeMint,
      ownerTokenAccount,
      tokenProgram,
    });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'withdraw'));
    const [pool] = stakingPoolPda(PROG);
    const [stakeAccount] = stakeAccountPda(PROG, pool, owner);
    const [vault] = stakeVaultPda(PROG, stakeAccount);
    expect(accountKeys(ix)).toEqual([
      pool.toBase58(),
      stakeAccount.toBase58(),
      stakeMint.toBase58(),
      vault.toBase58(),
      ownerTokenAccount.toBase58(),
      owner.toBase58(),
      tokenProgram.toBase58(),
    ]);
    expect(ix.keys[5].isSigner).toBe(true);
  });
});
