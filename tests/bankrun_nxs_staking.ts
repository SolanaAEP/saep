import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import { startAnchor, BankrunProvider } from 'anchor-bankrun';
import { ProgramTestContext } from 'solana-bankrun';
import { setBankrunClock, warpClockBy } from './helpers/bankrun';
import { createMint, createATA, mintTokens, getTokenBalance } from './helpers/token';
import {
  Keypair, PublicKey, SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';

import type { NxsStaking } from '../target/types/nxs_staking';

const T0 = 1_700_000_000n;
const DECIMALS = 6;
const MINT_AMOUNT = 100_000_000;

const SEVEN_DAYS = 7 * 24 * 3600;
const NINETY_DAYS = 90 * 24 * 3600;
const ONE_YEAR = 365 * 24 * 3600;
const COOLDOWN_SECS = 3 * 24 * 3600;
const EPOCH_DURATION = 3600;

const enc = (s: string) => Buffer.from(s);
const PROGRAM_ID = new PublicKey('GjXfJ6MHb6SJ4XBK3qcpGw4n256qYPrDcXrNj6kf2i2Z');

function configPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('staking_config')], PROGRAM_ID);
}

function poolPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('staking_pool')], PROGRAM_ID);
}

function guardPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('guard')], PROGRAM_ID);
}

function allowedCallersPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('allowed_callers')], PROGRAM_ID);
}

function stakeAccountPda(pool: PublicKey, owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [enc('stake'), pool.toBuffer(), owner.toBuffer()],
    PROGRAM_ID,
  );
}

function stakeVaultPda(stakeAccount: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [enc('stake_vault'), stakeAccount.toBuffer()],
    PROGRAM_ID,
  );
}

function epochSnapshotPda(epoch: number): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(epoch));
  return PublicKey.findProgramAddressSync([enc('epoch_snapshot'), buf], PROGRAM_ID);
}

describe('bankrun: nxs_staking — stake, unstake, withdraw, admin lifecycle', function () {
  this.timeout(60_000);

  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let program: anchor.Program<NxsStaking>;

  let authority: Keypair;
  const staker = Keypair.generate();
  const staker2 = Keypair.generate();
  const mintAuthority = Keypair.generate();

  let stakeMint: PublicKey;
  let stakerAta: PublicKey;
  let staker2Ata: PublicKey;

  const [configPdaKey] = configPda();
  const [poolPdaKey] = poolPda();

  before(async () => {
    context = await startAnchor('.', [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    authority = context.payer;

    const idl = JSON.parse(readFileSync(
      resolve(process.cwd(), 'target/idl/nxs_staking.json'), 'utf8'));
    program = new anchor.Program<NxsStaking>(idl, provider);

    for (const kp of [staker, staker2, mintAuthority]) {
      context.setAccount(kp.publicKey, {
        lamports: 100 * LAMPORTS_PER_SOL,
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        executable: false,
      });
    }

    await setBankrunClock(context, T0);

    stakeMint = await createMint(context, authority, mintAuthority.publicKey, DECIMALS, TOKEN_PROGRAM_ID);

    stakerAta = await createATA(context, authority, stakeMint, staker.publicKey, TOKEN_PROGRAM_ID);
    staker2Ata = await createATA(context, authority, stakeMint, staker2.publicKey, TOKEN_PROGRAM_ID);

    await mintTokens(context, authority, stakeMint, stakerAta, mintAuthority, MINT_AMOUNT, TOKEN_PROGRAM_ID);
    await mintTokens(context, authority, stakeMint, staker2Ata, mintAuthority, MINT_AMOUNT, TOKEN_PROGRAM_ID);
  });

  it('initialize + init_pool — config + pool created, stake_mint set', async () => {
    await program.methods
      .initialize(authority.publicKey)
      .accountsPartial({
        config: configPdaKey,
        payer: authority.publicKey,
      })
      .rpc();

    const cfg = await program.account.stakingConfig.fetch(configPdaKey);
    expect(cfg.authority.toBase58()).to.equal(authority.publicKey.toBase58());

    await program.methods
      .initPool(
        stakeMint,
        new BN(EPOCH_DURATION),
        new BN(1_000_000),
      )
      .accountsPartial({
        config: configPdaKey,
        pool: poolPdaKey,
        authority: authority.publicKey,
      })
      .rpc();

    const pool = await program.account.stakingPool.fetch(poolPdaKey);
    expect(pool.stakeMint.toBase58()).to.equal(stakeMint.toBase58());
    expect(pool.totalStaked.toNumber()).to.equal(0);
    expect(pool.totalStakers).to.equal(0);
    expect(pool.currentEpoch.toNumber()).to.equal(0);
    expect(pool.epochDurationSecs.toNumber()).to.equal(EPOCH_DURATION);
    expect(pool.paused).to.equal(false);
    expect(pool.closed).to.equal(false);
  });

  it('stake with 7d lockup — Active, vault funded, multiplier=1, voting_power=amount', async () => {
    const amount = 1_000_000;
    const [stakeAccPda] = stakeAccountPda(poolPdaKey, staker.publicKey);
    const [vaultPda] = stakeVaultPda(stakeAccPda);

    const balBefore = await getTokenBalance(context, stakerAta);

    await program.methods
      .stake(new BN(amount), new BN(SEVEN_DAYS))
      .accountsPartial({
        pool: poolPdaKey,
        stakeAccount: stakeAccPda,
        stakeMint,
        vault: vaultPda,
        ownerTokenAccount: stakerAta,
        owner: staker.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([staker])
      .rpc();

    const balAfter = await getTokenBalance(context, stakerAta);
    expect(Number(balBefore - balAfter)).to.equal(amount);

    const vaultBal = await getTokenBalance(context, vaultPda);
    expect(Number(vaultBal)).to.equal(amount);

    const sa = await program.account.stakeAccount.fetch(stakeAccPda);
    expect(JSON.stringify(sa.status)).to.equal(JSON.stringify({ active: {} }));
    expect(sa.amount.toNumber()).to.equal(amount);
    expect(sa.lockupMultiplier).to.equal(1);
    expect(sa.votingPower.toNumber()).to.equal(amount);
    expect(sa.owner.toBase58()).to.equal(staker.publicKey.toBase58());

    const pool = await program.account.stakingPool.fetch(poolPdaKey);
    expect(pool.totalStaked.toNumber()).to.equal(amount);
    expect(pool.totalStakers).to.equal(1);
  });

  it('stake with 365d lockup — multiplier=4, voting_power=amount*4', async () => {
    const amount = 500_000;
    const [stakeAccPda] = stakeAccountPda(poolPdaKey, staker2.publicKey);
    const [vaultPda] = stakeVaultPda(stakeAccPda);

    await program.methods
      .stake(new BN(amount), new BN(ONE_YEAR))
      .accountsPartial({
        pool: poolPdaKey,
        stakeAccount: stakeAccPda,
        stakeMint,
        vault: vaultPda,
        ownerTokenAccount: staker2Ata,
        owner: staker2.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([staker2])
      .rpc();

    const sa = await program.account.stakeAccount.fetch(stakeAccPda);
    expect(sa.lockupMultiplier).to.equal(4);
    expect(sa.votingPower.toNumber()).to.equal(amount * 4);
    expect(sa.amount.toNumber()).to.equal(amount);

    const pool = await program.account.stakingPool.fetch(poolPdaKey);
    expect(pool.totalStaked.toNumber()).to.equal(1_000_000 + amount);
    expect(pool.totalStakers).to.equal(2);
  });

  it('stake zero amount — ZeroAmount error', async () => {
    const newStaker = Keypair.generate();
    context.setAccount(newStaker.publicKey, {
      lamports: 100 * LAMPORTS_PER_SOL,
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });
    const newAta = await createATA(context, authority, stakeMint, newStaker.publicKey, TOKEN_PROGRAM_ID);
    await mintTokens(context, authority, stakeMint, newAta, mintAuthority, 1_000_000, TOKEN_PROGRAM_ID);

    const [stakeAccPda] = stakeAccountPda(poolPdaKey, newStaker.publicKey);
    const [vaultPda] = stakeVaultPda(stakeAccPda);

    let err: unknown;
    try {
      await program.methods
        .stake(new BN(0), new BN(SEVEN_DAYS))
        .accountsPartial({
          pool: poolPdaKey,
          stakeAccount: stakeAccPda,
          stakeMint,
          vault: vaultPda,
          ownerTokenAccount: newAta,
          owner: newStaker.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([newStaker])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/ZeroAmount/);
  });

  it('begin_unstake before lockup ends — LockupNotEnded error', async () => {
    const [stakeAccPda] = stakeAccountPda(poolPdaKey, staker.publicKey);

    let err: unknown;
    try {
      await program.methods
        .beginUnstake()
        .accountsPartial({
          pool: poolPdaKey,
          stakeAccount: stakeAccPda,
          owner: staker.publicKey,
        })
        .signers([staker])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/LockupNotEnded/);
  });

  it('begin_unstake — status Cooldown, total_staked decreased, cooldown_start set', async () => {
    // Warp past 7-day lockup
    await warpClockBy(context, SEVEN_DAYS + 1);

    const [stakeAccPda] = stakeAccountPda(poolPdaKey, staker.publicKey);
    const poolBefore = await program.account.stakingPool.fetch(poolPdaKey);

    await program.methods
      .beginUnstake()
      .accountsPartial({
        pool: poolPdaKey,
        stakeAccount: stakeAccPda,
        owner: staker.publicKey,
      })
      .signers([staker])
      .rpc();

    const sa = await program.account.stakeAccount.fetch(stakeAccPda);
    expect(JSON.stringify(sa.status)).to.equal(JSON.stringify({ cooldown: {} }));
    expect(sa.cooldownStart.toNumber()).to.be.greaterThan(0);

    const poolAfter = await program.account.stakingPool.fetch(poolPdaKey);
    expect(poolAfter.totalStaked.toNumber()).to.equal(
      poolBefore.totalStaked.toNumber() - sa.amount.toNumber(),
    );
  });

  it('withdraw before cooldown — CooldownNotEnded error', async () => {
    const [stakeAccPda] = stakeAccountPda(poolPdaKey, staker.publicKey);
    const [vaultPda] = stakeVaultPda(stakeAccPda);

    let err: unknown;
    try {
      await program.methods
        .withdraw()
        .accountsPartial({
          pool: poolPdaKey,
          stakeAccount: stakeAccPda,
          stakeMint,
          vault: vaultPda,
          ownerTokenAccount: stakerAta,
          owner: staker.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([staker])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/CooldownNotEnded/);
  });

  it('withdraw after cooldown (3d) — tokens returned to owner, status Withdrawn', async () => {
    await warpClockBy(context, COOLDOWN_SECS + 1);

    const [stakeAccPda] = stakeAccountPda(poolPdaKey, staker.publicKey);
    const [vaultPda] = stakeVaultPda(stakeAccPda);

    const saBefore = await program.account.stakeAccount.fetch(stakeAccPda);
    const stakedAmount = saBefore.amount.toNumber();
    const ownerBefore = await getTokenBalance(context, stakerAta);

    await program.methods
      .withdraw()
      .accountsPartial({
        pool: poolPdaKey,
        stakeAccount: stakeAccPda,
        stakeMint,
        vault: vaultPda,
        ownerTokenAccount: stakerAta,
        owner: staker.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([staker])
      .rpc();

    const ownerAfter = await getTokenBalance(context, stakerAta);
    expect(Number(ownerAfter - ownerBefore)).to.equal(stakedAmount);

    const sa = await program.account.stakeAccount.fetch(stakeAccPda);
    expect(JSON.stringify(sa.status)).to.equal(JSON.stringify({ withdrawn: {} }));
    expect(sa.amount.toNumber()).to.equal(0);
    expect(sa.votingPower.toNumber()).to.equal(0);

    const pool = await program.account.stakingPool.fetch(poolPdaKey);
    expect(pool.totalStakers).to.equal(1); // staker2 still active
  });

  it('freeze_deposits then stake — DepositsFrozen error', async () => {
    await program.methods
      .freezeDeposits()
      .accountsPartial({
        pool: poolPdaKey,
        authority: authority.publicKey,
      })
      .rpc();

    const pool = await program.account.stakingPool.fetch(poolPdaKey);
    expect(pool.pauseNewStakes).to.equal(true);

    // Try staking with a fresh keypair
    const frozenStaker = Keypair.generate();
    context.setAccount(frozenStaker.publicKey, {
      lamports: 100 * LAMPORTS_PER_SOL,
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });
    const frozenAta = await createATA(context, authority, stakeMint, frozenStaker.publicKey, TOKEN_PROGRAM_ID);
    await mintTokens(context, authority, stakeMint, frozenAta, mintAuthority, 1_000_000, TOKEN_PROGRAM_ID);

    const [frozenStakeAcc] = stakeAccountPda(poolPdaKey, frozenStaker.publicKey);
    const [frozenVault] = stakeVaultPda(frozenStakeAcc);

    let err: unknown;
    try {
      await program.methods
        .stake(new BN(100_000), new BN(SEVEN_DAYS))
        .accountsPartial({
          pool: poolPdaKey,
          stakeAccount: frozenStakeAcc,
          stakeMint,
          vault: frozenVault,
          ownerTokenAccount: frozenAta,
          owner: frozenStaker.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([frozenStaker])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/DepositsFrozen/);

    // Unfreeze for subsequent tests
    await program.methods
      .unfreezeDeposits()
      .accountsPartial({
        pool: poolPdaKey,
        authority: authority.publicKey,
      })
      .rpc();

    const poolAfter = await program.account.stakingPool.fetch(poolPdaKey);
    expect(poolAfter.pauseNewStakes).to.equal(false);
  });

  it('snapshot_epoch — VotingPowerSnapshot created, pool.current_epoch incremented', async () => {
    // Warp past epoch duration so snapshot is allowed
    await warpClockBy(context, EPOCH_DURATION + 1);

    const poolBefore = await program.account.stakingPool.fetch(poolPdaKey);
    const currentEpoch = poolBefore.currentEpoch.toNumber();
    const [snapPda] = epochSnapshotPda(currentEpoch);

    const totalVp = new BN(2_000_000);
    const stakerCount = 1;

    await program.methods
      .snapshotEpoch(totalVp, stakerCount)
      .accountsPartial({
        config: configPdaKey,
        pool: poolPdaKey,
        snapshot: snapPda,
        authority: authority.publicKey,
      })
      .rpc();

    const snap = await program.account.votingPowerSnapshot.fetch(snapPda);
    expect(snap.epoch.toNumber()).to.equal(currentEpoch);
    expect(snap.stakerCount).to.equal(stakerCount);
    expect(snap.snapshotTime.toNumber()).to.be.greaterThan(0);

    const poolAfter = await program.account.stakingPool.fetch(poolPdaKey);
    expect(poolAfter.currentEpoch.toNumber()).to.equal(currentEpoch + 1);
  });
});
