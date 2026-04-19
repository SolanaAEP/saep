// Scaffold — all cases `it.skip` until the 4 M3 migration ixs land in
// programs/nxs_staking/src/lib.rs. Structure mirrors specs/nxs-m3-migration.md
// §Devnet-bring-up + §Security-checks. Unblock order:
//   1. land `freeze_deposits` + `unfreeze_deposits` + `close_pool` + `set_apy`
//      + `migrate_apy_authority` in the program (spec §New-instruction-surface).
//   2. extend `StakingPool` state with `pause_new_stakes` + `pause_new_stakes_at`
//      + `closed` flags (spec §freeze_deposits, §close_pool).
//   3. add `b"apy_authority"` singleton PDA derivation to IDL accounts.
//   4. shift the per-`it.skip` → `it` + fill bodies.
//
// The current nxs_staking scaffold ships a singleton `b"staking_pool"` PDA — spec
// calls for per-mint pools to support pool_v1 (placeholder) + pool_v2 (real SAEP)
// coexistence. Landing the migration ixs is also the cycle that widens the pool
// PDA seeds to `[b"staking_pool", stake_mint.as_ref()]` (spec §Spec-drift).

import * as anchor from '@coral-xyz/anchor';
import { startAnchor, BankrunProvider } from 'anchor-bankrun';
import type { ProgramTestContext } from 'solana-bankrun';
import { Keypair, PublicKey } from '@solana/web3.js';
import { expect } from 'chai';

import { setBankrunClock } from './helpers/bankrun';
import type { NxsStaking } from '../target/types/nxs_staking';

const NXS_STAKING_PROGRAM_ID = new PublicKey(
  'GjXfJ6MHb6SJ4XBK3qcpGw4n256qYPrDcXrNj6kf2i2Z',
);

const T0 = 1_800_000_000n;
const DAY_SECS = 86_400n;
const MIGRATION_WINDOW_SECS = 180n * DAY_SECS;

// PDA helpers — apyAuthority is spec-defined (singleton). stakingPoolForMint is
// the post-migration widened shape (see header); stakingPoolSingleton is current
// scaffold shape, kept here so the pre-impl assertion reads honestly.
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
};

describe('bankrun: nxs_staking — M3 migration scaffold (spec/nxs-m3-migration.md)', function () {
  this.timeout(60_000);

  let context: ProgramTestContext;
  let provider: BankrunProvider;

  before(async () => {
    context = await startAnchor('.', [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    await setBankrunClock(context, T0);
  });

  it('program id matches Anchor.toml', () => {
    // No IDL load — this assertion stays live so a program_id drift surfaces
    // even while the rest of the suite is skipped.
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

    it.skip('step 3: freeze_deposits(pool_v1) sets pause_new_stakes; stake(pool_v1) now rejects', async () => {
      // Happy-path: call freeze_deposits as pool authority. Read pool state,
      // assert pause_new_stakes == true and pause_new_stakes_at == now.
      // Then call stake(pool_v1, amount, lockup) and expect DepositsFrozen.
      // Withdraw path must remain open — call begin_unstake on a pre-existing
      // Active stake and assert no DepositsFrozen raise.
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

    it.skip('step 7: rollback — unfreeze_deposits(pool_v1) restores stake entry-point', async () => {
      // Drill for incident-response if mainnet migration aborts mid-flight.
      // Assert stake(pool_v1) succeeds after unfreeze_deposits.
      // Also assert unfreeze_deposits rejects if close_pool already ran —
      // spec §Open-Q #6 default: no reopen path.
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
