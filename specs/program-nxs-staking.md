# Spec — NXSStaking Program

**Owner:** anchor-engineer
**Depends on:** SAEP Token-2022 mint with InterestBearing + TransferHook + PermanentDelegate + Pausable extensions (M3 spec, but the staking program ships against a placeholder mint on devnet pre-M3 and is migrated to the real mint post-M3); Squads multisig v4 (4-of-7 program council); GovernanceProgram (APY + param updates via CPI execute target).
**Blocks:** GovernanceProgram (voting power source + `verify_snapshot_root` view), DisputeArbitration (arbitrator stake), AgentRegistry post-M2 (operator stake migrated from generic SPL to NXS — out of M2 scope, flagged below), FeeCollector (slash destination consumer).
**References:** backend PDF §1.3 (SAEP mint extensions: InterestBearing APY governance-set, TransferHook callback for staker-share routing, PermanentDelegate transferred to FeeCollector at T+N, Pausable Phase 3 emergency council 4-of-7), §2.1 (CU targets — `stake` 30k / `unstake` 40k / `claim` 25k; deps GovernanceProgram + FeeCollector), §2.6 (deployment + upgrade table — 7d standard timelock; Squads 4-of-7), §4.3 (deploy order — NXSStaking lands after CapabilityRegistry + GovernanceCore but before AgentRegistry stake migration; 48h devnet timelock at init), §5.1 (Security checklist: re-entrancy, authorization, Token-2022 extension safety, slashing 30d timelock + cap, oracle staleness — none here, no upgrade authority outside Squads), §5.2 (multisig 4-of-7 + signer geo-distribution + HSM).

## Goal

The single staking primitive for SAEP. NXS holders lock tokens for a fixed duration to acquire (a) governance voting power, (b) eligibility to operate as an arbitrator, and post-M2 (c) eligibility to operate as an agent. InterestBearing yields accrue against the locked balance per §1.3 — the protocol's APY is set by GovernanceProgram and applied via the SAEP mint's InterestBearing extension. The program does NOT mint reward tokens; APY is the InterestBearing accrual on the underlying mint, surfaced through `amount_to_ui_amount`. Stakers `claim` is a no-op on principal and a re-snapshot of effective_stake against the current accrued amount.

Slashing is CPI-receivable from AgentRegistry / DisputeArbitration / GovernanceProgram via a uniform `Slasher` CPI contract — each slash is proposed (`propose_slash`) and time-locked 30 days per §5.1 before `execute_slash` moves tokens to FeeCollector via Token-2022 `transfer_checked`. Single-outstanding `PendingSlash` per `(stake_account, slasher)` pair caps the per-incident blast radius.

Merkle snapshots are computed off-chain by a permissionless cranker over the live staker set and committed on-chain via `commit_snapshot`. Voting CPIs from GovernanceProgram read the snapshot root and verify per-voter inclusion proofs — avoiding the O(N) on-chain pass across all stakers.

Every transition is signed, seeded, event-logged, and TransferHook-aware so the indexer can replay any stake event deterministically and the portal can surface live stake / yield / lock-status.

## State

### `StakingConfig` PDA — singleton
- **Seeds:** `[b"staking_config"]`
- **Fields:**
  - `authority: Pubkey` — Squads 4-of-7 program council (per §2.6)
  - `governance_program: Pubkey` — GovernanceProgram CPI identity (param updates + slash authorization for governance violations)
  - `agent_registry: Pubkey` — AgentRegistry CPI identity (slash for agent misbehavior)
  - `dispute_arbitration: Pubkey` — DisputeArbitration CPI identity (slash for arbitrator misbehavior)
  - `fee_collector: Pubkey` — destination of slashed tokens
  - `stake_mint: Pubkey` — SAEP mint (Token-2022 with InterestBearing + TransferHook + PermanentDelegate + Pausable)
  - `min_stake_amount: u64` — default `1_000 * 10^decimals`; rejects dust stakes
  - `min_lock_secs: i64` — default `30 * 86400` (30 days minimum lock; matches `min_lock_to_vote_secs` in GovernanceConfig)
  - `max_lock_secs: i64` — default `4 * 365 * 86400` (4 years; bounds InterestBearing accrual horizon and prevents indefinite locks)
  - `early_unstake_penalty_bps: u16` — default 0 (disabled M2; reviewer may enable for gradual-unlock model)
  - `apy_basis_points: i16` — current InterestBearing rate; mirrored from the mint's InterestBearing config; updated via `set_apy` (governance-only)
  - `apy_authority: Pubkey` — InterestBearing rate authority (the mint extension authority); always the GovernanceProgram-controlled PDA, never an EOA
  - `slash_timelock_secs: i64` — `30 * 86400` (mirrors AgentRegistry §5.1 / DisputeArbitration §2.5)
  - `max_slash_bps: u16` — 1000 (10% per-incident cap; same as DisputeArbitration `max_slash_bps`)
  - `snapshot_validity_slots: u64` — default 100 (~40s); a snapshot older than this is rejected by `verify_snapshot_root` to deter mid-vote stake mutation
  - `pending_snapshot_count: u32` — counter of un-finalized snapshots; bounded at 8 to limit DOS surface
  - `total_staked: u128` — running sum of principal across all StakeAccounts (post-slash adjusted)
  - `total_locked_eligible: u128` — running sum of principal where `lock_unlock_slot - now >= min_lock_to_vote_secs`; updated lazily on stake/unstake/lock-extend
  - `paused: bool` — global stake/unstake/claim pause; slash + execute_slash continue (cannot trap value during a pause)
  - `bump: u8`

### `StakeAccount` PDA — per `(operator, lock_id)`
- **Seeds:** `[b"stake", operator.as_ref(), lock_id.to_le_bytes()]` — `lock_id: u32` is operator-chosen; allows multiple concurrent stakes per operator with independent unlock schedules
- **Fields:**
  - `operator: Pubkey` — the staker's wallet (signer for stake / unstake / claim / extend)
  - `lock_id: u32`
  - `principal: u64` — original deposited amount; does NOT include InterestBearing yield (yield computed via `amount_to_ui_amount` on the mint at read-time)
  - `escrow_token_account: Pubkey` — Token-2022 ATA owned by the stake-escrow PDA (`[b"escrow", stake_account.as_ref()]`); holds the locked tokens
  - `staked_at: i64`
  - `lock_unlock_slot: u64` — when `unstake` becomes legal; computed as `current_slot + ceil(lock_secs / SLOT_DURATION_MS * 1000)`
  - `lock_unlock_ts: i64` — timestamp twin (slot drift tolerance — `unstake` validates BOTH; the conservative deadline wins)
  - `lock_secs: i64` — original chosen lock duration; bounds `extend_lock` (cannot shorten)
  - `status: StakeStatus`
  - `slash_total: u64` — cumulative slashed amount over this stake's lifetime; principal display = `principal - slash_total`
  - `pending_slash_count: u8` — number of outstanding `PendingSlash` records against this stake; bounded at 3 (caps concurrent slashing pressure)
  - `last_claim_slot: u64` — last `claim` invocation; informational only (claim doesn't move tokens, just refreshes the InterestBearing snapshot)
  - `bump: u8`

### `PendingSlash` PDA (mirrors AgentRegistry / DisputeArbitration pattern)
- **Seeds:** `[b"pending_slash", stake_account.as_ref(), slash_nonce.to_le_bytes()]` — `slash_nonce: u32` is `StakingConfig.next_slash_nonce`, monotonic; supports up to 3 concurrent slashes per StakeAccount
- **Fields:**
  - `stake_account: Pubkey`
  - `slasher_program: Pubkey` — must equal one of `agent_registry`, `dispute_arbitration`, `governance_program`
  - `amount: u64` — capped at `principal * max_slash_bps / 10000` per call
  - `reason_code: u8` — slasher-program-defined; opaque to NXSStaking
  - `proposed_at: i64`
  - `executable_at: i64` — `proposed_at + slash_timelock_secs`
  - `cancelled: bool` — set by `cancel_slash` (callable by `authority` until timelock elapses)
  - `bump: u8`

### `SnapshotAccount` PDA — per snapshot generation
- **Seeds:** `[b"snapshot", snapshot_id.to_le_bytes()]` — `snapshot_id: u64` is monotonic from `StakingConfig.next_snapshot_id`
- **Fields:**
  - `snapshot_id: u64`
  - `committed_by: Pubkey` — the cranker that called `commit_snapshot`
  - `committed_at_slot: u64`
  - `snapshot_root: [u8; 32]` — merkle root over `(operator, effective_stake)` leaves where `lock_unlock_slot - committed_at_slot >= min_lock_to_vote_secs`
  - `total_eligible_weight: u128` — sum of `effective_stake` across all leaves; used by GovernanceProgram quorum math
  - `total_eligible_count: u32` — leaf count; informational + DOS-bound on proof depth
  - `merkle_depth: u8` — log2(total_eligible_count) rounded up; bounded at 24 (covers ~16M stakers)
  - `expired_at_slot: u64` — `committed_at_slot + snapshot_validity_slots`; `verify_snapshot_root` rejects past this
  - `bump: u8`

  Off-chain cranker walks the live `StakeAccount` set, builds the merkle tree, and commits the root. Anyone can compute and commit; collisions resolved by `snapshot_id` monotonic claim. Stale snapshots (`now > expired_at_slot`) are eligible for `garbage_collect_snapshot` reclaim.

### `Slasher` registry — read-only enum derived from `StakingConfig`
- Not its own PDA. The set of allowed slasher programs is the 3 fields on `StakingConfig` (`agent_registry`, `dispute_arbitration`, `governance_program`). Adding a 4th slasher requires meta-governance (changes `StakingConfig` via GovernanceProgram CPI). M2-tight by design.

### `ReentrancyGuard` (program-global, scaffolded)
- Standard pattern from `programs/agent_registry/src/guard.rs` — guards inbound CPI on `propose_slash` (caller must be a registered slasher AND its caller-side guard must be inactive) and outbound CPI on `execute_slash` (state-write before the FeeCollector transfer CPI, reentrancy flag flipped before, unset on return).

## Enums

```
enum StakeStatus {
    Active,         // accruing yield, locked, can vote
    Unlocking,      // lock expired, awaiting `unstake` ix
    Withdrawn,      // tokens returned to operator; account closed at end of unstake ix
    Slashed,        // permanently flagged; slash_total >= principal (rare; ladder of bad-faith strikes)
}
```

`Withdrawn` and `Slashed` are terminal. `Active → Unlocking` is automatic at `lock_unlock_slot`; the status transition happens on the next `unstake` / `claim` / `commit_snapshot` read. No separate ix is needed.

## State machine

```
                   stake (operator-signed, transfer_checked → escrow)
                              |
                              v
                          Active
                              |
                  +-----------+-----------+
                  |                       |
        (lock window elapses)        propose_slash (CPI from slasher)
                  |                       |
                  v                       v
              Unlocking              PendingSlash
                  |                       |
            unstake                       | (30d timelock)
            (operator-signed,             v
             transfer_checked        execute_slash
             escrow → operator)      (transfer_checked
                  |                   escrow → fee_collector)
                  v                       |
              Withdrawn                   v
                                  +---- principal > 0? ----+
                                  | yes              | no
                                  v                  v
                              Active           Slashed (terminal)
```

Concurrent slashes do NOT block `unstake` post-lock-expiry; pending slashes are honored against the residual escrow at execute-time. Operator can `unstake` even with a `PendingSlash` outstanding — the unstaked amount is reduced by the sum of pending slashes (held back in escrow until `execute_slash` or `cancel_slash`).

## Instructions

### `init_config(authority, governance_program, agent_registry, dispute_arbitration, fee_collector, stake_mint, params)` — one-shot, deployer
- **Validation:** singleton — fails if `StakingConfig` exists.
- **Effect:** initializes `StakingConfig`. Creates the InterestBearing apy-authority PDA and asserts it is set as the mint's InterestBearing rate authority via `get_account_data_size` introspection on the mint extension (read-only verification; if the mint's authority isn't the PDA, init fails).
- **Emits:** `StakingInitialized`

### `stake(lock_id, principal, lock_secs)`
- **Signers:** `operator`
- **Validation:**
  - `!config.paused`.
  - `principal >= min_stake_amount`.
  - `min_lock_secs <= lock_secs <= max_lock_secs`.
  - StakeAccount for `(operator, lock_id)` does not already exist.
  - Mint of source ATA == `stake_mint`. Source ATA owner == `operator`.
- **Effect:** creates `StakeAccount { status: Active, principal, lock_unlock_slot, lock_unlock_ts }`. Initializes the escrow ATA owned by the per-stake escrow PDA. CPIs Token-2022 `transfer_checked` from `operator`'s ATA to escrow (NOT raw `transfer` — TransferHook on the mint requires `transfer_checked`). Increments `total_staked` and (if `lock_secs >= min_lock_to_vote_secs`) `total_locked_eligible`.
- **Emits:** `Staked { operator, lock_id, principal, lock_unlock_slot, apy_basis_points }`
- **CU target:** 30k

### `extend_lock(lock_id, additional_secs)`
- **Signers:** `operator`
- **Validation:** `!config.paused`. `StakeAccount.status == Active`. `additional_secs > 0`. `lock_secs + additional_secs <= max_lock_secs`.
- **Effect:** increases `lock_unlock_slot` and `lock_unlock_ts` by the equivalent slot/time deltas. Updates `lock_secs` for future bound checks. Updates `total_locked_eligible` if this transition crosses the `min_lock_to_vote_secs` threshold (e.g., a stake that was below voting threshold becomes eligible). No token movement.
- **Emits:** `LockExtended`

### `unstake(lock_id)`
- **Signers:** `operator`
- **Validation:**
  - `!config.paused`.
  - `StakeAccount.status ∈ {Active, Unlocking}`.
  - `now_slot >= lock_unlock_slot AND now_ts >= lock_unlock_ts` (both clocks must have elapsed — slot drift conservative).
  - Sum of `pending_slash_amount` across outstanding `PendingSlash` ≤ residual escrow balance.
- **Effect:** computes `withdrawable = escrow_balance - sum(pending_slash_amount)`. Transitions `status = Unlocking`, then immediately processes the withdrawal: CPI Token-2022 `transfer_checked` from escrow → operator's ATA for `withdrawable`. If `pending_slash_count == 0`, transitions to `Withdrawn` and closes the StakeAccount (rent reclaim to operator). If pending slashes remain, keeps the StakeAccount open with the residual escrow until each slash resolves (`execute_slash` → escrow drained, `cancel_slash` → operator can `claim_residual` to sweep).
- Decrements `total_staked` and (conditionally) `total_locked_eligible`.
- **Emits:** `Unstaked { operator, lock_id, withdrawable, residual_held }`
- **CU target:** 40k

### `claim_residual(lock_id)`
- **Signers:** `operator`
- **Validation:** `StakeAccount.status == Unlocking`. `pending_slash_count == 0`.
- **Effect:** sweeps residual escrow to operator's ATA. Closes StakeAccount; rent reclaimed.
- **Emits:** `ResidualClaimed`

### `claim(lock_id)` — no-op refresh
- **Signers:** `operator`
- **Validation:** `StakeAccount.status == Active`.
- **Effect:** updates `last_claim_slot`. Reads escrow balance via `amount_to_ui_amount` to surface accrued InterestBearing yield in the event. NO token movement (yield is accrued on the mint, not in this program). Used by the portal to refresh the staker's display.
- **Emits:** `YieldSnapshot { operator, lock_id, principal, current_balance, apy_basis_points }`
- **CU target:** 25k

### `set_apy(new_apy_basis_points)`
- **Signers:** `governance_program` (CPI identity check against `config.governance_program`)
- **Validation:** caller-program guard active per `ReentrancyGuard`. `new_apy_basis_points` within `[-10000, 10000]` (per Token-2022 InterestBearing spec).
- **Effect:** CPIs Token-2022 `interest_bearing_mint::update_rate(new_apy_basis_points)` with the apy-authority PDA as signer. Mirrors the new rate into `StakingConfig.apy_basis_points`. Effective on next slot.
- **Emits:** `ApyUpdated { old, new }`

### `commit_snapshot(snapshot_id, snapshot_root, total_eligible_weight, total_eligible_count, merkle_depth)` — permissionless cranker
- **Validation:**
  - `!config.paused`.
  - `snapshot_id == config.next_snapshot_id` (monotonic claim; rejects gaps and replays).
  - `merkle_depth <= 24`.
  - `pending_snapshot_count < 8` (DOS bound).
  - `total_eligible_count <= 2^merkle_depth`.
- **Effect:** initializes `SnapshotAccount`. Increments `next_snapshot_id` and `pending_snapshot_count`. NO on-chain validation that the root matches the live staker set — verifying the merkle tree is the cranker's responsibility, and disputes are resolved via the `dispute_snapshot` ix (any honest party can submit a counter-merkle-proof showing a missing or inflated leaf, which slashes the cranker's posted bond — see Open Questions).
- **Emits:** `SnapshotCommitted { snapshot_id, snapshot_root, total_eligible_weight, total_eligible_count, expires_at_slot }`

### `verify_snapshot_root(snapshot_id, voter, weight, merkle_proof)` — view-only CPI target
- **Signers:** any program (no signer; this is a read CPI)
- **Validation:**
  - `SnapshotAccount.snapshot_id == snapshot_id`.
  - `now_slot < expired_at_slot` (snapshot freshness).
  - Merkle inclusion proof of `(voter, weight)` against `snapshot_root`.
- **Effect:** returns success / fail to caller. No state mutation. GovernanceProgram calls this on every `vote` ix.
- **Emits:** none (view CPI — emitting from a view path violates the no-state-change contract).

### `garbage_collect_snapshot(snapshot_id)` — permissionless crank
- **Validation:** `now_slot > SnapshotAccount.expired_at_slot + GC_GRACE_SLOTS` (default GC_GRACE_SLOTS = 86400 ≈ 9.5 hours).
- **Effect:** closes `SnapshotAccount`; rent reclaimed to whoever calls. Decrements `pending_snapshot_count`. No event (purely operational).

### `propose_slash(stake_account, amount, reason_code)` — CPI-only
- **Signers:** caller program (one of `agent_registry` / `dispute_arbitration` / `governance_program`, identity-checked against `StakingConfig` fields)
- **Validation:**
  - Inbound `ReentrancyGuard.check_callee_preconditions`: caller's reentrancy flag must be active; NXSStaking's flag must be inactive pre-entry (rejects nested CPI).
  - `amount > 0 && amount <= principal * max_slash_bps / 10000`.
  - `pending_slash_count < 3`.
  - `StakeAccount.status != Slashed`.
- **Effect:** creates `PendingSlash { slasher_program: caller, executable_at: now + slash_timelock_secs }`. Increments `pending_slash_count`.
- **Emits:** `SlashProposed { stake_account, slasher, amount, executable_at }`

### `execute_slash(stake_account, slash_nonce)`
- **Signers:** any (permissionless crank)
- **Validation:** `now >= PendingSlash.executable_at`. `!PendingSlash.cancelled`. ReentrancyGuard active for outbound CPI.
- **Effect (state-before-CPI per §5.1):**
  - Decrements `pending_slash_count`.
  - Increments `slash_total` on the StakeAccount by `amount`.
  - If `slash_total >= principal`: status → `Slashed` (terminal).
  - Closes `PendingSlash` (rent → fee_collector).
  - Then CPI: Token-2022 `transfer_checked` from escrow → fee_collector's NXS ATA, signed by escrow PDA.
  - Decrements `total_staked` by `amount`.
- **Emits:** `SlashExecuted { stake_account, slasher, amount, post_principal }`

### `cancel_slash(stake_account, slash_nonce)`
- **Signers:** `authority` (Squads 4-of-7) OR the original `slasher_program` (e.g., DisputeArbitration's `cancel_slash` propagates to here)
- **Validation:** `!PendingSlash.cancelled`. `now < PendingSlash.executable_at`.
- **Effect:** marks `cancelled = true`. Decrements `pending_slash_count`. Closes the PendingSlash.
- **Emits:** `SlashCancelled`

### `set_params(params)`
- **Signers:** `governance_program` CPI (any tunable scalar — `min_stake_amount`, `min_lock_secs`, `max_lock_secs`, `slash_timelock_secs` (cannot shorten — only extend), `max_slash_bps` (cannot raise above 1000 without meta-governance — hardcoded ceiling), `snapshot_validity_slots`).
- **Validation:** caller = governance_program. Per-field bounds enforced (slash_timelock floor = 7d to keep hard-coded auditability lower bound; max_slash_bps ceiling = 1000 to prevent governance-driven 100%-slash attack — meta-governance can raise the ceiling but not the standard `set_params` path).
- **Emits:** `ParamsUpdated`

### `set_paused(paused: bool)`
- **Signers:** `authority` OR `emergency_council` (4-of-7 per §1.3, identity-checked against a separate `emergency_council` field — added to StakingConfig if not present at deploy; sourced from same Squads 4-of-7 as governance program's emergency council).
- **Effect:** flips `config.paused`. Stake / unstake / claim / extend_lock / commit_snapshot blocked while paused. Slash propose / execute / cancel + verify_snapshot_root continue (cannot trap value or block governance during a pause).
- **Emits:** `PausedSet`

### `transfer_authority_two_step(new_authority)` / `accept_authority()`
- Standard two-step authority handover for `StakingConfig.authority` (Squads multisig migration). Mirrors the pattern used in `agent_registry`.

## Events

M1 actually-emit (per `programs/nxs_staking/src/events.rs` + `emit!` call sites in `lib.rs`): `PoolInitialized`, `Staked`, `UnstakeInitiated`, `Withdrawn`, `EpochSnapshotted`. Renames from earlier spec drafts: `StakingInitialized` landed as `PoolInitialized`; the one-shot `Unstaked` split into the two-step `UnstakeInitiated` (begin_unstake, starts cooldown) + `Withdrawn` (withdraw, after cooldown); `SnapshotCommitted` landed as `EpochSnapshotted`.

Forward-looking M2-reserved (paired with spec-enumerated ixs not yet scaffolded against dedicated event types at M1): `LockExtended` (→ `extend_lock`), `ResidualClaimed` (→ `claim_residual`), `YieldSnapshot` (→ `claim`), `ApyUpdated` (→ `set_apy`), `SlashProposed` (→ `propose_slash`), `SlashExecuted` (→ `execute_slash`), `SlashCancelled` (→ `cancel_slash`), `ParamsUpdated` (→ `set_params`), `PausedSet` (→ `set_paused`), `AuthorityTransferProposed` + `AuthorityAccepted` (→ two-step authority-transfer ixs). Current scaffold lands `initialize` / `init_pool` / `stake` / `begin_unstake` / `withdraw` / `snapshot_epoch` + guard admin ops; the slash / residual-claim / APY / snapshot-verify / param-mutation ixs enumerated in §Instructions remain spec-only at M1.

Struct-defined but never `emit!`'d (scaffold parity with other programs' guard modules; wire-up lands when guard ixs go beyond the init/reset shapes): `GuardEntered`, `ReentrancyRejected`, `GuardInitialized`, `GuardAdminReset`, `AllowedCallersUpdated`.

All 5 M1-emit events carry `timestamp`; the 3 stake-scoped events (`Staked` / `UnstakeInitiated` / `Withdrawn`) carry `owner` (the stake-owner wallet; the `StakeAccount` PDA is derived off-chain from `owner` + `lock_id`). `PoolInitialized` carries `authority` + `stake_mint`; `EpochSnapshotted` carries `epoch` + `total_voting_power` + `staker_count`. No M1-emit event carries `slot` in the body — slot resolves from the containing transaction in the indexer. Only 2 of the 5 struct-only guard events (`GuardEntered`, `ReentrancyRejected`) carry `slot` in-body, matching the scaffold parity pattern across fee_collector / agent_registry / task_market guard modules.

## Errors

`Unauthorized`, `Paused`, `StakeBelowMin`, `LockTooShort`, `LockTooLong`, `WrongMint`, `LockNotElapsed`, `WrongStatus`, `PendingSlashOverflow`, `SlashAmountExceedsCap`, `SlashTimelockNotElapsed`, `SlashAlreadyCancelled`, `SnapshotIdMismatch`, `SnapshotExpired`, `MerkleProofInvalid`, `MerkleDepthExceeded`, `PendingSnapshotOverflow`, `SnapshotNotExpired`, `CallerNotRegisteredSlasher`, `CallerNotGovernance`, `ReentrancyDetected`, `UnauthorizedCaller`, `CpiDepthExceeded`, `ApyOutOfRange`, `ArithmeticOverflow`, `ResidualNotZero`. (Reentrancy / caller / CPI depth errors reuse existing scaffold enum.)

## CU budget (§2.1 targets; reviewer may tighten)

| Instruction | Target |
|---|---|
| `init_config` | 60k |
| `stake` | 30k |
| `extend_lock` | 15k |
| `unstake` | 40k |
| `claim_residual` | 25k |
| `claim` | 25k |
| `set_apy` | 30k (CPI dominated) |
| `commit_snapshot` | 30k |
| `verify_snapshot_root` | 5k + 1k × proof_depth (max 24 → ~30k worst-case) |
| `garbage_collect_snapshot` | 10k |
| `propose_slash` | 25k |
| `execute_slash` | 60k (CPI dominated) |
| `cancel_slash` | 15k |
| `set_params` | 15k |
| `set_paused` | 10k |

`stake` / `unstake` align with §2.1's stated 30k/40k. `verify_snapshot_root` is the hot path (every governance vote ix calls it) — reviewer may tighten the per-depth multiplier; current estimate is conservative against keccak256 hashing cost.

## Invariants

1. `total_staked == sum(StakeAccount.principal - StakeAccount.slash_total)` across all non-Withdrawn stakes. Verified by indexer reconciliation, not on-chain (would be O(N) per transaction).
2. `principal >= min_stake_amount` at stake-time. `slash_total <= principal` always.
3. `lock_unlock_slot - staked_at` corresponds to `lock_secs` within slot-rate tolerance. `extend_lock` only ever increases; never decreases.
4. `pending_slash_count <= 3` per StakeAccount. Single-outstanding `PendingSlash` per `(stake_account, slash_nonce)` enforced by seed.
5. `SlashExecuted` cannot fire before `executable_at`. `cancel_slash` cannot fire after `executable_at`.
6. `status == Withdrawn` ⇒ escrow balance == 0 AND pending_slash_count == 0 AND StakeAccount closed.
7. `status == Slashed` ⇒ `slash_total >= principal`. Operator cannot withdraw further.
8. `apy_basis_points` on `StakingConfig` mirrors the mint's InterestBearing rate (out-of-band drift only possible if someone bypasses `set_apy`; mint extension authority is the apy-authority PDA, so the only way to drift is direct meta-governance change to that PDA's seed program — caught at next `set_apy`).
9. `SnapshotAccount.expired_at_slot - committed_at_slot == config.snapshot_validity_slots`.
10. Merkle proof depth in `verify_snapshot_root` ≤ `SnapshotAccount.merkle_depth` ≤ 24.
11. `pending_snapshot_count <= 8`. Garbage collection reclaims past-grace expired snapshots.
12. Slashed tokens always reach `fee_collector.NXS_ATA`. No path leaves slashed tokens trapped in escrow.
13. `set_params` cannot shorten `slash_timelock_secs` below its current value, nor raise `max_slash_bps` above 1000 — hardcoded floors / ceilings outside meta-governance.

## Security checks (backend §5.1)

- **Account Validation:** Anchor seeds + bumps on `StakingConfig`, `StakeAccount`, `PendingSlash`, `SnapshotAccount`. Discriminator enforced. CPI identities for GovernanceProgram / AgentRegistry / DisputeArbitration / FeeCollector read from `StakingConfig` — hard equality, never caller-supplied. Mint identity hard-pinned at init; every `transfer_checked` call validates the mint matches.
- **Re-entrancy:** inbound CPI (`propose_slash` from registered slashers, `set_apy` / `set_params` from governance) goes through `check_callee_preconditions` — caller-side guard must be active, NXSStaking guard must be inactive pre-entry. Outbound CPI (`execute_slash` → FeeCollector, `set_apy` → mint InterestBearing extension) sets state before the CPI, so even a malicious downstream upgrade cannot re-enter and double-slash or double-rate-update.
- **Integer Safety:** `u128` for `total_staked` / `total_locked_eligible` (sum of u64 principals across many stakes can overflow u64). `checked_*` on principal arithmetic, slash subtraction, lock-deadline addition. `principal * max_slash_bps / 10000` computed in u128 then narrowed.
- **Authorization:** operator-signed for stake / unstake / claim / extend / claim_residual; CPI-only for propose_slash / set_apy / set_params; permissionless for execute_slash / commit_snapshot / garbage_collect_snapshot / verify_snapshot_root (all status- or freshness-gated); authority-signed for cancel_slash / set_paused / authority transfer.
- **Slashing Safety:** 30-day timelock + 10% per-incident cap + max 3 concurrent PendingSlash per StakeAccount. Uniform with AgentRegistry §5.1 + DisputeArbitration. `cancel_slash` available to authority OR the originating slasher until timelock elapses.
- **Token Safety:** All token movements via Token-2022 `transfer_checked` (mint-aware; respects TransferHook). No raw `transfer`. Escrow ATA owned by per-stake escrow PDA; PDA signs with `[b"escrow", stake_account.as_ref(), bump]` seeds. `init_config` verifies the apy-authority PDA matches the mint's InterestBearing rate authority — drift detected at boot, not at first `set_apy`.
- **Token-2022 Extension Safety:** `set_apy` validates `new_apy_basis_points ∈ [-10000, 10000]` per spec. `pause_mint` (Pausable extension) is owned by the emergency council, NOT this program — pausing the mint pauses NXS transfers globally, but this program's escrow flows continue (slash, residual claim) because they're CPI'd through the program's escrow PDA, which the Pausable check applies to identically — pause IS effective at the mint level. Distinct from `config.paused` which only blocks operator-initiated stake/unstake.
- **Upgrade Safety:** Squads 4-of-7, 7-day timelock per §2.6 (standard, not critical-path).
- **Pause:** `config.paused` blocks `stake`, `unstake`, `extend_lock`, `claim`, `claim_residual`, `commit_snapshot`. Leaves `verify_snapshot_root`, `propose_slash`, `execute_slash`, `cancel_slash` open so governance + slashing pipelines cannot be DOS'd by a pause. Mint-level Pausable is orthogonal.
- **Jito bundle assumption:** none. Stake / unstake are individually atomic; no multi-tx bundle dependency.
- **DOS surface:** `pending_snapshot_count <= 8` caps memory+rent for snapshot account proliferation. `pending_slash_count <= 3` per stake caps slasher write amplification. `merkle_depth <= 24` caps proof-verification cost. `commit_snapshot` is permissionless but bonded (see Open Questions for the bond shape).

## CPI contract surface

NXSStaking exposes 4 CPI targets to other SAEP programs:

1. `verify_snapshot_root(snapshot_id, voter, weight, merkle_proof) -> Result<()>` — view CPI; called by `GovernanceProgram::vote` per voter. No state change.
2. `propose_slash(stake_account, amount, reason_code)` — called by `AgentRegistry::propose_slash`, `DisputeArbitration::slash_arbitrator`, `GovernanceProgram::execute_proposal` (when category is governance-misbehavior — out of M2 scope but reserved). Caller must be a registered slasher.
3. `set_apy(new_apy_basis_points)` — called by `GovernanceProgram::execute_proposal` when category is `ParameterChange` targeting NXSStaking apy. Caller must be `governance_program`.
4. `set_params(params)` — called by `GovernanceProgram::execute_proposal` when category is `ParameterChange` targeting NXSStaking config. Caller must be `governance_program`.

Each CPI site on the caller side ends with reading the NXSStaking event log to confirm the effect — caller programs do NOT mirror NXSStaking state into their own PDAs (single source of truth).

## Devnet bring-up notes (§4.3)

- Init runs the 48h `dev_mode_timelock_override_secs` shadow per §4.3. The override only EXTENDS the natural timelock (max of computed + override). Cannot shorten.
- Pre-M3, `stake_mint` points at a placeholder SPL mint without InterestBearing. `set_apy` is a no-op against this mint (returns success, no rate change). Migration to the real Token-2022 mint at M3 is via meta-governance (changes `stake_mint` field — but: this is a dangerous knob. See Open Questions on migration path).
- A devnet-only `force_unstake` ix is intentionally NOT included. Devnet timelocks are real for slash testing; bankrun warps the clock instead.

## Open questions for reviewer

- **Snapshot honesty mechanism.** Spec says "honest party submits counter-merkle-proof to slash dishonest cranker" but doesn't specify the cranker bond size, dispute window, or counter-proof shape. Three options: (a) cranker posts a fixed bond at `commit_snapshot` (e.g., 1000 NXS), refunded after `expired_at_slot + GC_GRACE_SLOTS` if no dispute; (b) crankers are a registered set with their own NXSStaking accounts as the bond — cleaner but adds onboarding friction; (c) defer: M2 trusts the cranker (single Appfact-operated cranker), M3 introduces the bond. Default: option (c) for M2; flag in spec for M3.
- **Multiple-stakes-per-operator UX.** `lock_id` is operator-chosen; portal needs to enforce "smart" lock_id allocation (e.g., monotonic per-operator counter). Reviewer may want lock_id to be a u64 nonce derived from `now_slot ^ operator_seed_nonce` to prevent "stake_id 0 reused after withdraw and slash-pending sweep" footguns. Defer to portal SDK.
- **Early unstake.** `early_unstake_penalty_bps = 0` disables early unstake in M2 — operator must wait for lock expiry. Reviewer may push for a 10-25% slash-to-FeeCollector path so locked NXS isn't fully illiquid. Trade-off: enabling early unstake undermines the lock as a Sybil-resistance mechanism for governance. Default: M2 fully illiquid; revisit M3.
- **Stake migration from AgentRegistry.** AgentRegistry's `stake_mint` is currently a generic SPL token (cycle 39 baseline). Post-M2 migration to NXS as the operator stake currency requires either a one-shot `migrate_stake` CPI or operators manually withdraw → re-stake into NXSStaking. Reviewer's call. Default: defer migration spec to M3 alongside Token-2022 mint bootstrap.
- **APY auth model for the mint.** Spec assumes the mint's InterestBearing rate authority IS the NXSStaking apy-authority PDA. Alternative: a Squads 4-of-7 directly owns the rate authority, NXSStaking emits a "rate-update-requested" event but the council signs the actual mint update. The spec's path is more automation-friendly (governance vote → APY change in one tx after timelock); the alternative gives the council a hard veto. Default: spec's path; flag for reviewer.
- **`set_params` `slash_timelock_secs` ratchet direction.** Spec says cannot shorten — only extend. Reviewer may want a meta-governance escape hatch to shorten in case 30d proves operationally unworkable. Default: hardcoded floor at 7d via meta-governance, but standard `set_params` only extends.
- **Snapshot freshness 100 slots.** Tighter than Realms (no freshness). Same trade-off as GovernanceProgram snapshot freshness: prevents the rebalance-stake-then-vote attack but may force the cranker into a hot loop on a busy proposal. Default: 100; reviewer may widen.
- **`commit_snapshot` permissionless.** Anyone can commit. The honest cranker bond from option (c) above is the only thing preventing a malicious committer from spamming snapshots with the goal of exhausting the `pending_snapshot_count <= 8` bound to DOS legitimate commits. Default: bound at 8 with `garbage_collect_snapshot` reclaim by anyone after grace; reviewer may add a per-cranker rate-limit.
- **`max_slash_bps` ceiling 1000 (10%).** Hardcoded ceiling per the AgentRegistry / DisputeArbitration parity. Reviewer may want a per-slasher ceiling (e.g., DisputeArbitration capped at 5%, GovernanceProgram capped at 10%). Default: uniform 10%.
- **Lock duration max 4 years.** Picked to match the InterestBearing accrual horizon at typical APYs without u64 overflow on `amount_to_ui_amount`. Reviewer may shorten for governance health (4-year-locked voting power is a known governance-capture vector — see veNXS designs that decay over time).

## Done-checklist

- [ ] Full state machine implemented; illegal transitions rejected
- [ ] `stake` rejects below `min_stake_amount`, outside `[min_lock_secs, max_lock_secs]`, wrong mint, duplicate `lock_id`
- [ ] `unstake` rejects pre-lock-expiry on either slot OR timestamp clock; honors pending slashes in withdrawable calculation
- [ ] `extend_lock` only increases; updates `total_locked_eligible` correctly across the `min_lock_to_vote_secs` threshold
- [ ] `claim` is no-op on principal; surfaces InterestBearing yield via event
- [ ] `set_apy` CPIs the mint's InterestBearing extension; rejects out-of-range; mirror is consistent
- [ ] `commit_snapshot` rejects non-monotonic `snapshot_id`, over-bound depth, over-bound pending count
- [ ] `verify_snapshot_root` view CPI accepts valid proof, rejects invalid/expired/wrong-snapshot-id
- [ ] `propose_slash` only callable from registered slashers; bound by per-incident cap; bounded by `pending_slash_count`
- [ ] `execute_slash` honors 30d timelock; transfer to FeeCollector; updates `slash_total`; transitions to Slashed at total slash
- [ ] `cancel_slash` callable by authority OR original slasher within timelock
- [ ] `set_params` enforces `slash_timelock_secs` only-extend, `max_slash_bps` ceiling 1000
- [ ] `set_paused` blocks operator paths; leaves slash/governance/view paths open
- [ ] Reentrancy test: malicious slasher upgrade attempts re-entry on `propose_slash` — rejected
- [ ] Reentrancy test: malicious mint upgrade attempts re-entry during `set_apy` — rejected
- [ ] Token-2022 test: stake/unstake against mint with TransferHook attached — succeeds; raw `transfer` paths (if any) — fail at runtime
- [ ] Bankrun test: 30d slash timelock — propose, warp 30d-1s (rejected), warp +1s (executes)
- [ ] Bankrun test: 4-year lock — extend, unstake before expiry (rejected), warp to expiry (succeeds)
- [ ] Snapshot freshness test: commit, vote within `snapshot_validity_slots` (succeeds), vote after (rejected)
- [ ] Golden-path integration test (localnet): stake → vote via GovernanceProgram CPI → unstake post-lock; full lifecycle
- [ ] Slash path integration test: AgentRegistry CPI propose → 30d warp → execute → FeeCollector NXS_ATA balance up
- [ ] CU measurements per instruction in `reports/nxs-staking-anchor.md`
- [ ] IDL at `target/idl/nxs_staking.json`
- [ ] Security auditor pass (§5.1); findings closed
- [ ] Reviewer gate green; spec ready for Neodyme M2 queue
