// Scaffold — some cases `it.skip` until the remaining M3 migration ixs land
// in programs/nxs_staking/src/lib.rs. Structure mirrors
// specs/nxs-m3-migration.md §Devnet-bring-up + §Security-checks. Unblock order:
//   1. land `close_pool` + `set_apy` + `migrate_apy_authority` in the program
//      (spec §New-instruction-surface; `freeze_deposits` + `unfreeze_deposits`
//      landed cycle 202).
//   2. extend `StakingPool` state with `closed` flag (spec §close_pool).
//   3. add `b"apy_authority"` singleton PDA derivation to IDL accounts.
//   4. shift the per-`it.skip` → `it` + fill bodies.
//
// The current nxs_staking scaffold ships a singleton `b"staking_pool"` PDA — spec
// calls for per-mint pools to support pool_v1 (placeholder) + pool_v2 (real SAEP)
// coexistence. Landing the migration ixs is also the cycle that widens the pool
// PDA seeds to `[b"staking_pool", stake_mint.as_ref()]` (spec §Spec-drift).

import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import { startAnchor, BankrunProvider } from 'anchor-bankrun';
import type { ProgramTestContext } from 'solana-bankrun';
import {
  Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';

import { setBankrunClock, warpClockBy } from './helpers/bankrun';
import { createATA, createToken2022Mint, mintTokens } from './helpers/token';
import type { NxsStaking } from '../target/types/nxs_staking';

const NXS_STAKING_PROGRAM_ID = new PublicKey(
  'GjXfJ6MHb6SJ4XBK3qcpGw4n256qYPrDcXrNj6kf2i2Z',
);

const T0 = 1_800_000_000n;
const DAY_SECS = 86_400n;
const MIN_LOCKUP_SECS = 7n * DAY_SECS;
const INITIAL_BALANCE = 10_000_000;
const STAKE_AMOUNT = 100_000;

const pdas = {
  apyAuthority: (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('apy_authority')],
      NXS_STAKING_PROGRAM_ID,
    ),
  stakingPoolSingleton: (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('staking_pool')],
      NXS_STAKING_PROGRAM_ID,
    ),
  stakingPoolForMint: (stakeMint: PublicKey): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('staking_pool'), stakeMint.toBuffer()],
      NXS_STAKING_PROGRAM_ID,
    ),
  stakeAccount: (pool: PublicKey, owner: PublicKey): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('stake'), pool.toBuffer(), owner.toBuffer()],
      NXS_STAKING_PROGRAM_ID,
    ),
};

describe('bankrun: nxs_staking — M3 migration scaffold (spec/nxs-m3-migration.md)', function () {
  this.timeout(60_000);

  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let program: anchor.Program<NxsStaking>;

  let authority: Keypair;
  const owner1 = Keypair.generate();
  const owner2 = Keypair.generate();
  const mintAuthority = Keypair.generate();

  let stakeMint: PublicKey;
  let owner1Ata: PublicKey;
  let owner2Ata: PublicKey;
  let poolPda: PublicKey;
  let owner1StakePda: PublicKey;

  before(async () => {
    context = await startAnchor('.', [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    authority = context.payer;

    const idl = JSON.parse(
      readFileSync(resolve(process.cwd(), 'target/idl/nxs_staking.json'), 'utf8'),
    );
    program = new anchor.Program<NxsStaking>(idl, provider);

    for (const kp of [owner1, owner2, mintAuthority]) {
      context.setAccount(kp.publicKey, {
        lamports: 100 * LAMPORTS_PER_SOL,
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        executable: false,
      });
    }

    await setBankrunClock(context, T0);

    stakeMint = await createToken2022Mint(context, authority, mintAuthority.publicKey, 6);
    owner1Ata = await createATA(context, authority, stakeMint, owner1.publicKey);
    owner2Ata = await createATA(context, authority, stakeMint, owner2.publicKey);
    await mintTokens(context, authority, stakeMint, owner1Ata, mintAuthority, INITIAL_BALANCE);
    await mintTokens(context, authority, stakeMint, owner2Ata, mintAuthority, INITIAL_BALANCE);

    [poolPda] = pdas.stakingPoolSingleton();
    await program.methods
      .initPool(stakeMint, new BN(86_400), new BN(0))
      .accountsPartial({ authority: authority.publicKey })
      .rpc();

    // owner1 seed stake — exercises step 3's withdraw-path-remains-open assertion
    // once clock warps past lockup_end.
    [owner1StakePda] = pdas.stakeAccount(poolPda, owner1.publicKey);
    await program.methods
      .stake(new BN(STAKE_AMOUNT), new BN(MIN_LOCKUP_SECS))
      .accountsPartial({
        pool: poolPda,
        owner: owner1.publicKey,
        stakeMint,
        ownerTokenAccount: owner1Ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([owner1])
      .rpc();
  });

  it('program id matches Anchor.toml', () => {
    expect(NXS_STAKING_PROGRAM_ID.toBase58()).to.equal(
      'GjXfJ6MHb6SJ4XBK3qcpGw4n256qYPrDcXrNj6kf2i2Z',
    );
  });

  it('apy_authority PDA derivation is singleton (seeds = [b"apy_authority"])', () => {
    const [a] = pdas.apyAuthority();
    const [b] = pdas.apyAuthority();
    expect(a.toBase58()).to.equal(b.toBase58());

    // Per spec §apy_authority-PDA-design: not per-pool. Constructing a would-be
    // per-pool shape and asserting it differs guards against a future refactor
    // that accidentally re-derives per mint/pool.
    const fakeMint = Keypair.generate().publicKey;
    const [perMint] = pdas.stakingPoolForMint(fakeMint);
    expect(a.toBase58()).to.not.equal(perMint.toBase58());
  });

  describe('§Devnet-bring-up — rehearsal sequence (spec rows 132-140)', () => {
    it.skip('step 2: init_pool(pool_v2) asserts mint.InterestBearingRateAuthority == apy_authority PDA', async () => {
      // Impl: read mint extension via `getMintWithExtensions` post-init, assert
      // `interestBearingConfig.rateAuthority` bytes equal the apy_authority PDA.
      // Reject with InterestBearingAuthorityMismatch otherwise (spec §Security-checks #1).
    });

    it('step 3: freeze_deposits(pool_v1) sets pause_new_stakes; stake(pool_v1) rejects; withdraw path stays open', async () => {
      await program.methods
        .freezeDeposits()
        .accountsPartial({ pool: poolPda, authority: authority.publicKey })
        .rpc();

      const poolAfterFreeze = await program.account.stakingPool.fetch(poolPda);
      expect(poolAfterFreeze.pauseNewStakes).to.equal(true);
      expect(poolAfterFreeze.pauseNewStakesAt.toNumber()).to.be.greaterThan(0);

      // Entry path rejects while the pool is frozen.
      let stakeErr: unknown;
      try {
        await program.methods
          .stake(new BN(STAKE_AMOUNT), new BN(MIN_LOCKUP_SECS))
          .accountsPartial({
            pool: poolPda,
            owner: owner2.publicKey,
            stakeMint,
            ownerTokenAccount: owner2Ata,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([owner2])
          .rpc();
      } catch (e) {
        stakeErr = e;
      }
      expect(String(stakeErr)).to.match(/DepositsFrozen/);

      // Re-freeze fail-loud against already-frozen pool (spec §Invariants row 4).
      let refreezeErr: unknown;
      try {
        await program.methods
          .freezeDeposits()
          .accountsPartial({ pool: poolPda, authority: authority.publicKey })
          .rpc();
      } catch (e) {
        refreezeErr = e;
      }
      expect(String(refreezeErr)).to.match(/DepositsFrozen/);

      // Exit path unaffected by the entry-only freeze — spec §Security-checks #5.
      // Warp past owner1's lockup_end first so the begin_unstake lockup guard passes.
      await warpClockBy(context, MIN_LOCKUP_SECS + 1n);
      await program.methods
        .beginUnstake()
        .accountsPartial({
          pool: poolPda,
          stakeAccount: owner1StakePda,
          owner: owner1.publicKey,
        })
        .signers([owner1])
        .rpc();

      const owner1StakeAfter = await program.account.stakeAccount.fetch(owner1StakePda);
      expect(owner1StakeAfter.status).to.deep.equal({ cooldown: {} });
    });

    it.skip('step 4: migration flow — begin_unstake → warp cooldown → withdraw → re-stake in pool_v2', async () => {
      // 3 rehearsal wallets; assert pool_v2.total_staked == sum(withdrawals).
      // Lockup reset is part of the spec design (§Stake-state-preservation) —
      // assert pool_v2 stake_account.lockup_end is computed fresh from the new
      // lockup_duration_secs arg, NOT carried over from pool_v1.
    });

    it.skip('step 5: set_apy(pool_v2, 500) drives mint.InterestBearingConfig.currentRate to 500', async () => {
      // Post-CPI assertion reads the mint extension to confirm the rate landed.
      // Mirror assertion on pool.apy_basis_points (spec §Invariants row 3).
    });

    it.skip('step 5b: amount_to_ui_amount on pool_v2 vault balance grows ~5% over 1y simulated', async () => {
      // Warp clock by 365 * DAY_SECS; call Token-2022 `amount_to_ui_amount` RPC
      // against vault balance; expected growth factor 1.05 ± epsilon (discrete
      // compounding at the InterestBearing rate).
    });

    it.skip('step 6: close_pool(pool_v1) after total_staked drains; subsequent stake rejects with PoolClosed', async () => {
      // Precondition branches:
      //   (a) total_staked == 0 path — close_pool succeeds immediately.
      //   (b) window-elapsed path — warp pause_new_stakes_at + 180d; total_staked
      //       may be nonzero; close_pool still succeeds.
      //   (c) neither — close_pool rejects with MigrationWindowActive.
    });

    it('step 7: rollback — unfreeze_deposits(pool_v1) restores stake entry-point + re-unfreeze fails loud', async () => {
      // Continuation of step-3 state: pool is frozen; owner2 unstaked; clock past T0 + 7d.
      await program.methods
        .unfreezeDeposits()
        .accountsPartial({ pool: poolPda, authority: authority.publicKey })
        .rpc();

      const poolAfterThaw = await program.account.stakingPool.fetch(poolPda);
      expect(poolAfterThaw.pauseNewStakes).to.equal(false);
      expect(poolAfterThaw.pauseNewStakesAt.toNumber()).to.equal(0);

      await program.methods
        .stake(new BN(STAKE_AMOUNT), new BN(MIN_LOCKUP_SECS))
        .accountsPartial({
          pool: poolPda,
          owner: owner2.publicKey,
          stakeMint,
          ownerTokenAccount: owner2Ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([owner2])
        .rpc();

      const [owner2Stake] = pdas.stakeAccount(poolPda, owner2.publicKey);
      const owner2StakeAcc = await program.account.stakeAccount.fetch(owner2Stake);
      expect(owner2StakeAcc.amount.toNumber()).to.equal(STAKE_AMOUNT);
      expect(owner2StakeAcc.status).to.deep.equal({ active: {} });

      // Spec §Open-Q #6 default: no reopen path for a close_pool'd pool. Re-unfreeze
      // on an already-thawed pool rejects as fail-loud idempotency (same pattern
      // as re-freeze above). Covers the "no-op hides a bug" class of spec §set_apy row 67.
      let rethawErr: unknown;
      try {
        await program.methods
          .unfreezeDeposits()
          .accountsPartial({ pool: poolPda, authority: authority.publicKey })
          .rpc();
      } catch (e) {
        rethawErr = e;
      }
      expect(String(rethawErr)).to.match(/DepositsNotFrozen/);
    });
  });

  describe('§Security-checks — fail-loud paths (spec rows 114-120)', () => {
    it.skip('check #1: init_pool against mint with mismatched rate authority rejects', async () => {
      // Construct a Token-2022 mint whose InterestBearingRateAuthority is some
      // other pubkey (not apy_authority PDA). init_pool must reject with
      // InterestBearingAuthorityMismatch.
    });

    it.skip('check #2: set_apy against non-InterestBearing (placeholder SPL) mint rejects', async () => {
      // Pre-M3 behavior per §Open-Q #4 + spec row 67. Placeholder SPL mint
      // with no InterestBearing extension. set_apy must reject with
      // MintNotInterestBearing — NOT silent no-op.
    });

    it.skip('check #3: close_pool pre-window with nonzero total_staked rejects', async () => {
      // Parallel to §Devnet-bring-up step 6 branch (c), but framed as the
      // security-check: governance cannot prematurely close a pool that
      // still has locked stake. Reject with MigrationWindowActive.
    });

    it.skip('check #4: set_apy reentrancy — CPI revert leaves pool.apy_basis_points unchanged', async () => {
      // Mock the Token-2022 `interest_bearing_mint_update_rate` CPI to revert
      // (e.g. by sending a rate outside the mint's own bounds). Assert
      // pool.apy_basis_points == prior value post-failed-tx.
    });

    it.skip('check #5: set_apy from non-GovernanceProgram caller rejects via AllowedCallers guard', async () => {
      // Direct invocation (without governance CPI) from a random signer must
      // reject with CallerNotAllowed. Reuses cycle-95 AllowedCallers PDA pattern.
    });

    it.skip('check #6: set_apy with |rate_bps| > 1000 rejects with RateOutOfBounds', async () => {
      // Spec §set_apy validation: range [-1000, 1000]. Assert both +1001 and
      // -1001 reject; assert -1000 + +1000 accept as boundary.
    });
  });

  describe('§Events — migrate_apy_authority attestation', () => {
    it.skip('migrate_apy_authority emits ApyAuthorityMigrated { old_mint, new_mint, attested_at }', async () => {
      // No-op on state per spec §migrate_apy_authority — event-only CPI. Indexer
      // + portal key off the event, not polling. Assert event fields exactly
      // match the tx args + clock unixTimestamp.
    });
  });
});
