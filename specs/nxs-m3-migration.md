# NXSStaking M3 migration — placeholder SPL → real SAEP Token-2022 mint

**Status:** spec draft. Executes at M3 alongside `specs/token2022-saep-mint.md` ceremony. Not actionable until FeeCollector + NXSStaking + GovernanceProgram are deployed to devnet (per token2022 §Done-checklist rows 3-5) and the rehearsal SAEP mint is initialized (row 6).

**Depends on:** `specs/token2022-saep-mint.md` (real SAEP mint with InterestBearing + TransferHook + PermanentDelegate + Pausable), `specs/program-nxs-staking.md` (pool state + stake/unstake lifecycle), `specs/program-governance.md` (APY-change proposal category), `specs/program-fee-collector.md` (TransferHook callback target), Squads multisig v4 6-of-9 program council.

**Blocks:** `specs/token2022-saep-mint.md` §Done-checklist row 9 ("Devnet NXSStaking M3 migration tested against rehearsal mint"). M3 InterestBearing APY activation — no set_apy rail exists pre-M3 so governance cannot drive the rate until migration lands.

**References:** `specs/program-nxs-staking.md` §Pre-M3 note (line 337), §Open-Qs "APY auth model for the mint" (line 346) + "Stake migration from AgentRegistry" (line 345); `specs/token2022-saep-mint.md` §4 InterestBearing (line 62-67) + §Done-checklist row 9; backend PDF §1.3 InterestBearing design.

---

## Goal

Cut the live NXSStaking program over from the pre-M3 placeholder SPL mint (no InterestBearing, no TransferHook) to the real Token-2022 SAEP mint (6 extensions active) without losing user principal and without opening a pause-window where stake is neither in the old pool nor the new. Land the `set_apy` rail so GovernanceProgram can drive InterestBearing rate changes post-migration.

Migration is a one-time event per deployment (devnet rehearsal + mainnet ceremony). Stakers opt in per-stake: the protocol does not force-migrate locked stake. Principal preservation is guaranteed; lockup + voting-power state is reset (see §Stake-state-preservation).

## Pre-M3 state vs M3 target state

| Surface | Pre-M3 | M3 target |
|---|---|---|
| Stake mint | generic SPL placeholder (no extensions) | Token-2022 SAEP mint (6 extensions) |
| Pool(s) | `StakingPool` initialized once against placeholder mint at cycle-90 scaffold | Two pools coexist during migration window: `pool_v1` (placeholder, deposits frozen) + `pool_v2` (real SAEP) |
| APY rail | none — `set_apy` ix not scaffolded; spec §Open-Qs line 346 deferred to M3 | `set_apy(rate_bps)` ix CPIs Token-2022 InterestBearing via apy_authority PDA |
| apy_authority PDA | n/a (no InterestBearing on placeholder) | singleton seeds `[b"apy_authority"]` owned by NXSStaking; set as the mint's `InterestBearingRateAuthority` at token2022 handover T+1 |
| TransferHook | n/a | FeeCollector program receives `execute` callback on every NXS transfer; stake/unstake paths must sign the hook PDA or be listed in FeeCollector's agent-hook allowlist |
| Lockup state | live on `StakeAccount.lockup_end` + `.lockup_multiplier` | reset on opt-in; re-stake in pool_v2 starts a fresh lock |
| Voting power | counted against governance snapshots on pool_v1 | pool_v2 snapshot_epoch rows count; pool_v1 snapshots drop out of quorum once pool_v2 `total_staked` exceeds it |

## Spec drift — existing impl vs `specs/program-nxs-staking.md`

Cycle-90 scaffold (`programs/nxs_staking/src/lib.rs`) diverged from the spec on two points relevant to migration:

1. **Pool vs Config.** Spec describes a `StakingConfig` singleton holding `stake_mint` + `apy_authority` + `apy_basis_points`. Impl ships `StakingPool` per-mint (see `lib.rs:79 init_pool`) with `stake_mint: Pubkey` set at init. Migration follows the impl's pool-based pattern: each mint = its own pool. `StakingConfig` from the spec is compatible as a guard/admin singleton (present in impl per `lib.rs:25 initialize`); the per-mint binding lives on `StakingPool`.
2. **No `set_apy` handler.** Spec line 187 defines `set_apy(new_apy_basis_points)` with InterestBearing CPI. Impl does not carry it. M3 migration lands it as a new instruction (see §New-ix-surface).

These drifts are not bugs in the scaffold — they are scoping choices from cycle 90 that pushed the M3-dependent surfaces out of M1. The migration spec accepts the pool-based shape as the source of truth and specifies new ixs against it.

## Migration mechanics — step-by-step

Timeline relative to M3 mint ceremony T+0 (per `specs/token2022-saep-mint.md` §Multisig-ceremony):

- **T+0 (ceremony):** Real SAEP mint init + metadata + handover complete. `apy_authority` PDA is set as the mint's `InterestBearingRateAuthority` during handover. No NXSStaking state touched yet.
- **T+1d (post-handover):** Governance proposal lands `init_pool(pool_v2, stake_mint=SAEP_MINT, epoch_duration_secs, reward_rate_per_epoch=0)`. Pool_v2 authority = Squads 4-of-7 program council per `specs/program-nxs-staking.md` §Authority.
- **T+1d + 1 tx:** Governance proposal lands `freeze_deposits(pool_v1)` — new `pause_new_stakes` flag on pool_v1 blocks `stake` entry-points but leaves `begin_unstake` + `withdraw` unblocked. Cooldown + slashing continue on pool_v1.
- **T+1d → T+N (migration window):** Stakers invoke `begin_unstake(pool_v1)` → wait `COOLDOWN_SECS` (per `lib.rs:194` = 48h on mainnet per `state.rs`) → `withdraw(pool_v1)` → receive placeholder-mint tokens → convert via Appfact off-chain swap (see §Placeholder-swap) → `stake(pool_v2, amount, lockup_duration_secs)` with real SAEP.
- **T+N (migration close):** Once `pool_v1.total_staked == 0` OR 180 days elapsed (whichever first), governance proposes `close_pool(pool_v1)` — closes the pool account + reclaims rent to FeeCollector treasury. Residual unmigrated stakers (if any) had 180d window; their locked tokens remain withdrawable from the pool_v1 escrow PDA (rent-exempt retained) but voting power permanently drops to 0.

Stakers who never invoke `begin_unstake` during the migration window keep their principal — `withdraw` remains callable post-close_pool — but their stake contributes no governance weight (pool_v1 snapshots dropped).

## New instruction surface

### `freeze_deposits(pool: Pubkey)`
- **Caller:** pool authority (Squads 4-of-7).
- **Effect:** sets `pool.pause_new_stakes = true`. `stake` handler adds a `require!(!pool.pause_new_stakes)` gate (additive to existing `!pool.paused`; semantics differ — `paused` blocks all ops including withdraw, `pause_new_stakes` blocks only entry).
- **Reverse:** `unfreeze_deposits(pool)` for rollback during rehearsal.

### `close_pool(pool: Pubkey)`
- **Caller:** pool authority.
- **Validation:** `pool.total_staked == 0` OR `now >= pool.pause_new_stakes_at + MIGRATION_WINDOW_SECS` (180d default, settable via meta-governance).
- **Effect:** marks `pool.closed = true`. Withdraw path checks `!pool.closed || sa.status == Cooldown` — residuals can still exit but no new state. Rent on `StakingPool` account is NOT reclaimed at M3 (keep the PDA accessible for residual withdraws); a future `reclaim_pool_rent` ix can land post-grace if needed.

### `set_apy(pool: Pubkey, new_apy_basis_points: i16)`
- **Caller:** GovernanceProgram CPI only; caller-program guard via `AllowedCallers` PDA per `specs/program-nxs-staking.md` §Auth + cycle-95 scaffold pattern.
- **Validation:** `new_apy_basis_points ∈ [-1000, 1000]` (10% cap per spec §4 defense-in-depth); reentrancy guard active.
- **Effect:** signed CPI to Token-2022 `interest_bearing_mint_update_rate(mint, new_apy_basis_points)` using the `apy_authority` PDA seeds `[b"apy_authority"]`. Updates `pool.apy_basis_points` mirror post-CPI. On M1/M2 pre-M3 against the placeholder mint: returns `MintNotInterestBearing` error (no silent no-op — cycle-94-era "no-op against placeholder" behavior is rejected as footgun: governance votes that silently succeed against the wrong mint are worse than failing loud).

### `migrate_apy_authority(old_mint: Pubkey, new_mint: Pubkey)` — ceremony-only
- **Caller:** GovernanceProgram CPI only (Meta category; Squads 6-of-9 + 21d timelock per specs/program-governance).
- **Effect:** no-op on NXSStaking state — the apy_authority PDA seeds are static `[b"apy_authority"]` so the same PDA signs for both mints; the real mint's InterestBearingRateAuthority is set to this PDA at token2022 handover T+1 (outside NXSStaking). This ix exists only as the **governance attestation** that the cutover is complete. Emits `ApyAuthorityMigrated { old_mint, new_mint, attested_at }`. Downstream systems (indexer, portal) key off the event, not off-chain polling.

## apy_authority PDA design

**Seeds:** `[b"apy_authority"]` (singleton, derived from NXSStaking program ID). Not per-pool. Rationale: Token-2022 `InterestBearingRateAuthority` is a single Pubkey per mint — there is no "rate authority per whatever" abstraction below the mint. A per-pool PDA would require a new PDA at each `init_pool` and would never match the mint's rate authority field. Singleton is the only shape that survives the handover.

**Derivation:** `PublicKey.findProgramAddressSync([Buffer.from('apy_authority')], NXSStaking::ID)`. Hard-coded in token2022 handover tx per `specs/token2022-saep-mint.md` line 138. Changing NXSStaking's program ID invalidates the PDA — hence NXSStaking must ship before the real SAEP mint.

## Stake-state preservation

**What is preserved:** principal (token amount). Stakers withdraw N tokens from pool_v1, convert off-chain, stake N tokens in pool_v2.

**What is reset:**
- **Lockup duration.** Pool_v1 stake with 3y remaining lockup becomes pool_v2 stake with whatever `lockup_duration_secs` the staker picks on re-stake. A 3y pool_v1 lock becomes a 0-year pool_v2 lock if the staker opts for the minimum.
- **Voting power multiplier.** Pool_v1 `lockup_multiplier` (derived via `compute_multiplier`) resets; pool_v2 re-stake gets a fresh multiplier against its own `lockup_duration_secs`.
- **Cumulative earned-reward snapshots.** Pre-M3 `pending_rewards` on pool_v1 stakes is irrelevant (placeholder mint had no InterestBearing); claim + withdraw settle to zero by design.
- **Governance snapshot history.** `SnapshotAccount` rows from pool_v1 remain on-chain for audit but stop counting toward new proposals once pool_v2 has the majority of stake.

**Why reset rather than carry-forward:** a `migrate_stake(pool_v1 → pool_v2, preserve_lockup)` ix would require the program to (a) burn pool_v1 escrow tokens + mint-or-swap pool_v2 tokens atomically, (b) port the lockup_end + multiplier, (c) handle cross-mint vault-rent differences. That surface is ~300-500 LOC of new audit scope + non-trivial atomicity-across-mint design + coupling to the placeholder-swap mechanism. Principal-only migration is ~30 LOC (the two new ixs above) and zero cross-mint atomicity. Stakers lose up to 4 years of lockup bonus on migration; the lockup bonus was itself part of governance-capture defense which a post-M3 staker can re-acquire by re-locking. The trade-off favors the simpler surface.

## Placeholder → real SAEP swap path

Pre-M3 placeholder tokens are not retail tradeable — they exist only on devnet for NXSStaking integration testing and (if deployed to mainnet before M3) for internal team locks. At M3:

- **Devnet rehearsal:** Placeholder = a freshly-created SPL mint held by Appfact. At migration-window close, Appfact burns unclaimed placeholder supply. Off-chain swap = Appfact watches `Withdrawn` events on pool_v1 and mints equivalent real-SAEP into the staker's wallet. Fully manual; idempotent via event-id keyed ledger.
- **Mainnet (if placeholder ever deployed there):** Same pattern — Appfact treasury holds reserved real-SAEP supply equal to placeholder supply + publishes a claim portal. 180d window matches migration close. Unclaimed residuals are a policy call, flagged below.

No on-chain burn-mint atomic swap is spec'd. The off-chain swap is acceptable because (a) placeholder is not retail, (b) the window is long (180d), (c) the alternative — on-chain cross-mint swap ix — adds a permanent-delegate-like surface that would need its own audit and expire at M3 anyway.

## CPI contract

**Outbound (new at M3):**
- `NXSStaking::set_apy` → Token-2022 `interest_bearing_mint_update_rate` signed by apy_authority PDA.

**Inbound (new at M3):**
- `GovernanceProgram::execute_proposal(ParameterChange, target=NXSStaking::set_apy)` → `NXSStaking::set_apy`.
- `GovernanceProgram::execute_proposal(Meta, target=NXSStaking::migrate_apy_authority)` → `NXSStaking::migrate_apy_authority`.
- `GovernanceProgram::execute_proposal(ParameterChange, target=NXSStaking::{freeze_deposits, close_pool})` → corresponding handlers.

**Unchanged:** existing stake/unstake/withdraw rails carry through both pools unchanged; TransferHook callbacks on real SAEP mint route to FeeCollector without NXSStaking involvement (FeeCollector reads `pool_v2.vault` as a known escrow via its agent-hook allowlist — listed at T+1d post-pool_v2 init).

## Security checks

1. **apy_authority PDA drift detection.** `init_pool(pool_v2)` reads the mint's `InterestBearingRateAuthority` via extension introspection and asserts it equals `find_program_address([b"apy_authority"], NXSStaking::ID)`. If the handover set the wrong authority, init_pool fails — no rate updates can be driven against a wrong-auth mint.
2. **`set_apy` fail-loud against non-InterestBearing mints.** Rejects with `MintNotInterestBearing` rather than silent no-op. Prevents governance votes from succeeding against a placeholder mint that silently ignores the rate.
3. **Migration-window bounded.** `MIGRATION_WINDOW_SECS` = 180d hardcoded ceiling; `close_pool` cannot run earlier than `pool.pause_new_stakes_at + MIGRATION_WINDOW_SECS` unless `total_staked == 0`. Prevents a race where governance prematurely closes pool_v1 and orphans stakers mid-cooldown.
4. **Reentrancy.** `set_apy` sets `pool.apy_basis_points` mirror AFTER the InterestBearing CPI returns success; if the CPI reverts, the mirror is not touched. `freeze_deposits` + `close_pool` use the existing `ReentrancyGuard` pattern from cycle-95 scaffold.
5. **Pause semantics.** `pause_new_stakes` (migration) is additive to `paused` (emergency). Both are checked on entry; withdraw path is guarded only by `paused`, not `pause_new_stakes`. Emergency pause during migration freezes everything including migration exits — this is intentional; an emergency pause is a post-hoc incident response that supersedes any ongoing migration.
6. **AllowedCallers gate for `set_apy`.** Reuses cycle-95 `AllowedCallers` PDA pattern — only programs listed in it can invoke. Default list at init_config: GovernanceProgram program ID only. A hotfix path for mis-set rates does not bypass governance.

## Invariants

1. Post-migration: `pool_v2.stake_mint == SAEP_MINT` and `SAEP_MINT.InterestBearingRateAuthority == find_program_address([b"apy_authority"], NXSStaking::ID)`.
2. For every stake withdrawn from pool_v1 with amount N, Appfact off-chain ledger records a real-SAEP mint-or-transfer of N into the same wallet within 48h (SLO, not on-chain-enforced).
3. `set_apy(pool_v2, rate)` success ⇒ `SAEP_MINT.interest_bearing_config.rate_authority_bps == rate` at slot `N+1`. Drift between mirror and mint extension is impossible (both updated in the same tx via the CPI).
4. `close_pool(pool_v1)` ⇒ `pool_v1.total_staked == 0` OR 180d-elapsed. No orphaning of locked stake is possible.
5. Pre-M3 `set_apy` calls (if the ix is shipped before M3 mint): rejects all inputs with `MintNotInterestBearing`.
6. Migration is idempotent from the staker's perspective: withdrawing from pool_v1 + staking in pool_v2 can be retried on failure. No burned-no-minted or minted-no-burned state.

## Devnet bring-up

Rehearsal sequence (assumes rows 3-5 of token2022 §Done-checklist complete):

1. **Rehearsal mint init.** Per token2022 `--devnet` flow. Real SAEP mint created with bootstrap-signer as all 6 authorities. InterestBearing rate authority set to `find_program_address([b"apy_authority"], NXSStaking::ID)` — bootstrap signer never holds this one; the PDA is set at mint init directly via `interest_bearing_initialize`.
2. **Pool_v2 init.** Invoke `init_pool(stake_mint=rehearsal_mint, epoch_duration_secs=86400, reward_rate_per_epoch=0)` as governance proposal (devnet single-sig variant). Assert `pool.stake_mint == rehearsal_mint` and the mint's rate_authority == apy_authority PDA.
3. **Freeze pool_v1.** `freeze_deposits(pool_v1)`. Assert new `stake(pool_v1)` calls revert with `DepositsFrozen`.
4. **Exercise migration.** Three rehearsal-staker wallets each `begin_unstake` → warp cooldown → `withdraw` → off-chain Appfact-ledger record → `stake(pool_v2, fresh_lock)`. Assert `pool_v2.total_staked == sum(withdrawals)`.
5. **APY rail.** Governance `set_apy(pool_v2, 500)` (5% APY). Assert via `getAccountInfo(rehearsal_mint)` that the InterestBearing extension reads rate=500. Assert `amount_to_ui_amount(stake_amount, decimals, now+1y)` on a pool_v2 vault balance grows by ~5% vs now.
6. **Close pool_v1.** `close_pool(pool_v1)` after `total_staked == 0`. Assert subsequent `stake(pool_v1)` + `begin_unstake(pool_v1)` revert with `PoolClosed`. Residual staker count (wallets that never migrated) must be 0 for the rehearsal to pass.
7. **Un-migrate (rollback drill).** `unfreeze_deposits(pool_v1)` + verify pool_v1 accepts deposits again. Prepares for incident-response if mainnet migration needs to abort mid-flight.

## Open questions for reviewer

1. **Residual staker policy at 180d.** What happens to mainnet stakers who never migrate? (a) principal stays withdrawable forever from pool_v1 escrow (conservative, may leave sub-cent dust PDAs on-chain); (b) after 180d + 1y, unclaimed residuals sweep to FeeCollector treasury with a governance-ratified delay (permissive, requires a new `sweep_residuals` ix). Default: (a).
2. **Appfact off-chain swap failure path.** If Appfact misses a `Withdrawn` event and fails to mint real-SAEP, what's the staker recourse? On-chain we'd need a `claim_unswapped` ix keyed on event-id that re-triggers. Flagged as op-risk; default: manual via support queue during migration window.
3. **Lockup bonus preservation.** Reviewer may push back on the full-reset design. Carry-forward alternative: `migrate_stake_atomic(pool_v1_stake, pool_v2)` ix that requires both mints be token-2022-compatible (they're not — placeholder is SPL) so the alternative is actually a `burn_placeholder + stake_v2_with_carry_forward` pair. Default: full reset. Cost of the alternative is ~300-500 LOC + cross-mint atomicity design.
4. **set_apy pre-M3 behavior.** Spec says fail-loud with `MintNotInterestBearing`. NXSStaking spec line 337 original said silent no-op. Fail-loud is better (no wasted governance votes) but deploying set_apy pre-M3 means governance proposals against it revert — surfaces tooling awareness requirement. Default: ship set_apy only at M3 alongside migration, not earlier.
5. **Migration window length.** 180d. Reviewer may want 365d (more forgiving of retail stakers missing the announcement cycle) or 90d (tighter state-machine close). Default: 180d = half the SAEP-M1-to-M3 cycle length.
6. **`close_pool` reversibility.** Set `pool.closed = true` is a one-way flag today. If mainnet migration needs to abort after `close_pool`, there is no `reopen_pool` ix. Adding one is cheap but widens the attack surface (closed pools would need a timelock to reopen). Default: no reopen; rollback must happen before `close_pool` via `unfreeze_deposits`.
7. **Token-2022 mint authority at rehearsal vs mainnet.** Rehearsal mint uses bootstrap signer as authority for all 6 extensions (per token2022 §Devnet-bring-up). Apy_authority is an exception — it's the PDA from the start. Reviewer may want devnet to match mainnet handover exactly (apy_authority = bootstrap pre-T+1, PDA post-T+1) so the migration-handover path is exercised identically. Default: devnet sets PDA directly; mainnet does the handover. Trade-off: exercises less of the ceremony on devnet.
8. **IACP announcement of migration window.** Migration open/close should emit through IACP discovery feed so portal + wallets can surface "your stake needs action." No channel exists yet; scope is a new `stake.migration.*` topic in IACP bus spec. Default: defer to IACP cycle; migration ceremony runbook includes manual-announcement via team channels until IACP topic lands.

## Done-checklist

- [ ] `freeze_deposits` + `unfreeze_deposits` + `close_pool` + `set_apy` + `migrate_apy_authority` ixs landed in `programs/nxs_staking`; fuzz harness extended for new surfaces
- [x] `apy_authority` PDA derivation helper added to `@saep/sdk/pda/index.ts` (singleton seeds `[b"apy_authority"]`; public `f5bc876`, cycle 198)
- [ ] Devnet rehearsal mint init succeeds with InterestBearing rate_authority = apy_authority PDA (drift-detect asserted)
- [ ] Devnet pool_v2 init succeeds against rehearsal mint; `init_pool` drift-detect passes
- [ ] Devnet migration exercise: 3 rehearsal wallets complete begin_unstake → withdraw → re-stake in pool_v2
- [ ] Devnet `set_apy(pool_v2, 500)` updates rehearsal mint's InterestBearing rate
- [ ] Devnet `amount_to_ui_amount` test shows ~5% growth over simulated 1y horizon
- [ ] `close_pool(pool_v1)` passes after total_staked drains
- [ ] Rollback drill: `unfreeze_deposits(pool_v1)` restores deposit path mid-rehearsal
- [~] Bankrun test `tests/bankrun_nxs_m3_migration.ts` covers: set_apy fail-loud pre-M3, freeze + withdraw + close_pool happy path, apy_authority PDA drift rejection (scaffold landed `a55d5ef` — 2 live cases + 12 `it.skip` gated on the 4 M3 ixs)
- [ ] Appfact off-chain swap ledger design reviewed + scripted (`scripts/migration/swap-ledger.ts`) + idempotent
- [ ] Residual staker policy ratified (Open-Q #1) + documented in ops runbook
- [ ] IACP topic `stake.migration.*` added to `specs/08-iacp-bus.md` OR deferred with runbook fallback
- [ ] Mainnet migration runbook lands under `docs/ops/nxs-m3-migration-runbook.md` with per-step go/no-go gates
- [ ] OtterSec / Halborn M3 audit reviews set_apy + migration surface
