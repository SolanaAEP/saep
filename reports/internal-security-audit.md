# SAEP Internal Security Audit — Pre-OtterSec Review

**Date:** 2026-04-17
**Scope:** All 10 Anchor programs in `programs/`
**Priority:** M1 core (task_market, agent_registry, treasury_standard, fee_collector, proof_verifier) first, then M2 programs

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1     |
| High     | 4     |
| Medium   | 8     |
| Low      | 6     |
| Info     | 5     |

---

## Findings

### Critical

| ID | Program | File | Line | Description | Fix |
|----|---------|------|------|-------------|-----|
| C-1 | fee_collector | `instructions/commit_distribution.rs` | 21 | **Missing authority check on `committer`**: `commit_distribution_root` accepts any signer as `committer` with no `has_one = authority` or similar constraint. Any user can commit an arbitrary merkle root, enabling them to claim the entire staker vault by constructing a proof against their own root. | Add `has_one = authority` on the config or constrain `committer` to `config.authority` or a dedicated `meta_authority`/`emergency_council`. |

### High

| ID | Program | File | Line | Description | Fix |
|----|---------|------|------|-------------|-----|
| H-1 | fee_collector | `instructions/process_epoch.rs` | 64-65 | **Missing address constraint on `grant_recipient` and `treasury_recipient`**: These token accounts have only `token::mint` checks but no `address = config.grant_recipient` / `address = config.treasury_recipient` constraint. A malicious cranker can substitute their own token account and divert the grant and treasury fee shares. | Add `address = config.grant_recipient` on `grant_recipient` and `address = config.treasury_recipient` on `treasury_recipient`. |
| H-2 | treasury_standard | `instructions/withdraw.rs` | 44-45 | **Missing authority constraint on `destination` token account**: The destination has only `token::mint` but no `token::authority` check and no call-target validation on the destination's owner. An operator could withdraw to any token account of the correct mint, bypassing the allowed-targets guardrail's intent. The `assert_call_target_allowed` check validates the token program key, not the destination. | Add a constraint tying destination to the operator or an approved target, or validate `destination.owner` against allowed targets. |
| H-3 | nxs_staking | `lib.rs` | 384-399 | **`init_pool` has no authority gate**: Any signer can call `init_pool` and set themselves as pool authority. The pool PDA (`seeds = [b"staking_pool"]`) is a singleton, so only the first call succeeds, but if called before the legitimate authority it constitutes a front-run takeover. | Add `has_one = authority` against the `StakingConfig` account, matching `InitGuard`/`SetAllowedCallers` pattern. |
| H-4 | task_market | `instructions/reveal_bid.rs` | 42-44 | **Reveal phase transition never explicitly set**: `BidBook.phase` is never transitioned from `Commit` to `Reveal`. The handler accepts reveals when `phase == Commit || phase == Reveal`, relying only on the time window (`now >= commit_end`). While functionally safe due to the time-window check, this means `commit_bid` also checks `phase == Commit` but a bid committed during the reveal window (after `commit_end`) would fail the time check, not the phase check. The phase field is semantically stale. | Explicitly transition `phase` to `BidPhase::Reveal` in `reveal_bid` when `phase == Commit && now >= commit_end` for clarity and defense-in-depth. |

### Medium

| ID | Program | File | Line | Description | Fix |
|----|---------|------|------|-------------|-----|
| M-1 | treasury_standard | `instructions/withdraw.rs` | 82-88 | **Oracle bypass for non-USDC mints**: When `price_feed` is `None`, the raw `amount` is used as `normalized` without conversion. An operator holding a high-decimal, low-value mint could claim it equals base units 1:1, bypassing spend limits. Only safe if all allowed mints are pegged stablecoins with 6 decimals. | Require `price_feed` for any mint where `decimals != BASE_DECIMALS` or where the mint is not a known stablecoin. Alternatively, fail closed when `price_feed` is absent for non-whitelisted mints. |
| M-2 | task_market | `instructions/release.rs` | 38-39 | **Unvalidated agent_token_account destination**: `agent_token_account` has `token::mint` but no `token::authority` constraint. A cranker can direct the agent payout to any account of the correct mint. The agent's operator should be the authority. | Add `token::authority = agent_account.operator` or equivalent constraint. |
| M-3 | task_market | `instructions/release.rs` | 42-44 | **Unvalidated fee_collector and solrep destination accounts**: `fee_collector_token_account` and `solrep_pool_token_account` have `token::mint` but no address check against `global.fee_collector` or `global.solrep_pool`. A cranker could substitute arbitrary accounts. | Add `address` constraint referencing global config values, or validate token account authority matches the expected program/entity. |
| M-4 | fee_collector | `instructions/sweep_stale.rs` | 24 | **Unchecked `epoch_id + 1` overflow in PDA seed**: `next_epoch` uses `(epoch_id + 1).to_le_bytes()` in the seeds constraint. If `epoch_id == u64::MAX`, this wraps to 0. | Add `require!(epoch_id < u64::MAX)` or use `checked_add`. |
| M-5 | dispute_arbitration | `instructions/resolution.rs` | 66-67 | **Appeal collateral truncation**: Collateral is computed as `u128` then cast to `u64` with `as u64`. For enormous escrow amounts this could truncate, though practically unlikely. | Use `u64::try_from(collateral).map_err(...)`. |
| M-6 | treasury_standard | `instructions/withdraw_earned.rs` | 206-209 | **Stale data read after Jupiter CPI**: `escrow.reload()` and `agent_vault.reload()` are correctly called, but `execute_swap` uses `remaining_accounts` passed by the operator. A malicious operator could craft remaining_accounts to route the swap through a compromised program. Mitigated by `global.jupiter_program` check and `jup.executable` check, but the remaining_accounts are not validated. | Consider logging/constraining remaining_accounts or at minimum documenting this as an accepted risk since the operator is the economic party. |
| M-7 | governance_program | `instructions/execute.rs` | 93-106 | **Governance CPI execution is a stub**: `execute_handler` records success without actually dispatching a CPI. A proposal marked `Executed` has no on-chain effect. Acceptable for M2 structural scaffold but must be wired before any governance action is trusted. | Wire actual CPI dispatch before enabling real governance. |
| M-8 | agent_registry | `instructions/reputation.rs` | 188 | **`volume` field uses `saturating_add` instead of `checked_add`**: While capped at 10,000 via `.min(10_000)`, the saturation before the cap means an overflow would silently produce `u16::MAX` (65535) before being clamped. Not exploitable in practice since `saturating_add(1)` on a `u16` only saturates at 65535, and `min(10_000)` clamps it. | No action required; behavior is correct. Noting for completeness. |

### Low

| ID | Program | File | Line | Description | Fix |
|----|---------|------|------|-------------|-----|
| L-1 | task_market | `instructions/init_global.rs` | 20-21 | **`init_global` has no authority check on `payer`**: Any signer can initialize the global singleton. Since it's a one-shot PDA init, only the first call succeeds. A front-run on devnet/mainnet deploy could set an attacker's authority. | Consider deploy-time init via the upgrade authority or add a hardcoded expected authority check. |
| L-2 | agent_registry | `instructions/init_global.rs` | (same pattern) | Same issue as L-1: `init_global` has no authority gate. | Same fix. |
| L-3 | treasury_standard | `instructions/init_global.rs` | (same pattern) | Same issue as L-1. | Same fix. |
| L-4 | task_market | `state.rs` | 93 | **`capability_bit` cast safety**: `1u128 << (payload.capability_bit as u32)` — `capability_bit` is validated to be `<= 127` by `payload.validate()`, but `create_task` calls the shift before `validate()` returns. Actually, `validate()` is called at line 74, before the shift at line 94. Safe as written, but worth noting the dependency. | No action needed; ordering is correct. |
| L-5 | fee_collector | `instructions/claim_staker.rs` | 105-106 | **Runtime `find_program_address` in claim path**: `Pubkey::find_program_address` is called at runtime to derive `vault_bump` instead of using `ctx.bumps.staker_vault`. This wastes ~1500 CU per call. | Use `ctx.bumps.staker_vault` instead. |
| L-6 | nxs_staking | `lib.rs` | 432 | **`owner_token_account` missing `token::authority = owner`**: In `StakeTokens`, the owner's token account has `token::mint` but no `token::authority` check. Since the operator signs and the CPI requires their authority, the worst case is the operator choosing to fund from someone else's delegated account. Not a security issue per se, but inconsistent with other programs. | Add `token::authority = owner` for consistency. |

### Info

| ID | Program | File | Description |
|----|---------|------|-------------|
| I-1 | task_market | `instructions/governance.rs` L71 | `set_hook_allowlist_ptr` is one-shot (rejects if already set). This is intentional per spec but means a misconfigured pointer cannot be corrected without a program upgrade. Document this constraint. |
| I-2 | All programs | guard.rs | Reentrancy guard pattern is consistent across task_market, agent_registry, treasury_standard, proof_verifier. The guard is slot-based, not held across transactions. Good. |
| I-3 | proof_verifier | `instructions/verify_proof.rs` | CPI depth is hard-capped at `stack_height <= 2`. This means only single-hop CPI callers are supported. Deeper CPI chains (e.g., governance -> task_market -> proof_verifier) will fail. Documented in comments but worth flagging to OtterSec as intentional. |
| I-4 | task_market | `instructions/close_bidding.rs` | Bid enumeration uses `remaining_accounts` with manual PDA verification. The duplicate-bidder check uses linear scan (`seen_bidders.iter().any()`). For 64 max bidders this is O(n^2) — ~4096 comparisons. Acceptable for current `MAX_BIDDERS_PER_TASK = 64` but would become a CU concern at higher caps. |
| I-5 | dispute_arbitration | `instructions/resolution.rs` L68-69 | Appeal collateral transfer is marked as "M2 structural" stub (no actual token transfer). The collateral amount is computed but never locked. Must be wired before M2 goes live. |

---

## Vulnerability Class Coverage

### 1. Missing signer checks
- **C-1**: `commit_distribution_root` committer lacks authority check (Critical)
- All other privileged instructions properly use `Signer` + `has_one` or explicit key comparisons.

### 2. PDA seed collisions
- No collisions found. Seeds are well-namespaced across programs (`b"task"`, `b"agent"`, `b"treasury"`, etc.) and include sufficient discriminating fields (client+nonce, operator+agent_id, agent_did, etc.).
- CategoryReputation uses `[b"rep", agent_did, capability_bit.to_le_bytes()]` — no collision risk.

### 3. Unchecked arithmetic
- All programs consistently use `checked_add`, `checked_sub`, `checked_mul` with `ArithmeticOverflow` errors.
- One `saturating_sub` in `nxs_staking::begin_unstake` for `total_staked` (L179) — acceptable since it's a counter decrement that can't underflow past the stake being removed.
- M-5: `as u64` truncation in dispute_arbitration appeal collateral.

### 4. Missing owner validation
- Cross-program account reads use `seeds::program` with correct program keys.
- `close_bidding` manually verifies remaining_accounts agent owner against `agent_registry` program key (L121).
- H-1, H-2, M-2, M-3: Missing address/authority constraints on destination token accounts.

### 5. CPI re-entrancy
- Comprehensive reentrancy guard system across all CPI-capable programs.
- State-before-CPI pattern followed in release, expire, claim_bond, process_epoch, execute_burn, sweep_stale.
- `verify_task` correctly holds the guard across the proof_verifier CPI.

### 6. Missing close account drain
- `cancel_unfunded_task`: `close = client` with proper status check. Good.
- `close_bid`: `close = bidder` only after `bid.refunded`. Good.
- `close_bid_book`: `close = client` only after `bond_escrow.amount == 0`. Good.
- `cancel_bidding`: `close = client` only when `commit_count == 0`. Good.
- No issues found.

### 7. Authority escalation
- Two-step authority transfer (transfer + accept) used consistently across all programs. Good.
- H-3: `init_pool` in nxs_staking lacks authority gate.
- L-1/L-2/L-3: `init_global` instructions can be front-run.

### 8. Token account validation
- `token::mint` constraints present on all token accounts.
- `token::authority` constraints present on source accounts (operator/client).
- H-1, H-2, M-2, M-3: Missing constraints on destination/recipient accounts.

### 9. Stale data reads
- `withdraw_earned` correctly calls `escrow.reload()` and `agent_vault.reload()` after Jupiter CPI.
- No other post-CPI data reads found without reload.

### 10. Integer truncation
- M-5: `as u64` truncation in dispute_arbitration.
- `ewma` return: `(sum / BPS_DENOM) as u16` — safe because inputs are `u16` and alpha is bounded, so result is bounded by input range. Verified by proptest.
- `compute_fees`, `compute_bond_amount`: use `u64::try_from()` with error propagation. Good.

---

## Recommendations for OtterSec Prep

1. **Fix C-1 immediately** — the `commit_distribution_root` authority gap is the single exploitable finding that could drain the staker vault.
2. **Fix H-1** — process_epoch destination validation is the second priority. Combined with C-1, an attacker could both set the distribution root AND receive the grant/treasury shares.
3. **Fix H-2, M-2, M-3** — token account destination validation gaps should be closed before any mainnet deploy.
4. **Wire H-4** — add explicit phase transition for bid reveal for defense-in-depth.
5. **Document I-1, I-3, I-5** — OtterSec will flag these as design decisions; having written rationale ready saves audit cycles.
6. **Address L-1/L-2/L-3** — init_global front-run protection. Consider using the program's upgrade authority as a deploy-time gate.

---

## Fix Status (2026-04-17)

| ID | Status | Fix Applied |
|----|--------|-------------|
| C-1 | **FIXED** | Added `committer.key() == config.authority \|\| config.meta_authority` constraint |
| H-1 | **FIXED** | Added `address = config.grant_recipient` / `address = config.treasury_recipient` |
| H-2 | **FIXED** | Added `token::authority = operator` on destination |
| H-3 | ACCEPTED | Singleton PDA — first-caller wins. Deploy scripts must init atomically |
| H-4 | **FIXED** | Explicit `BidPhase::Commit → BidPhase::Reveal` transition in reveal_bid |
| M-2 | **FIXED** | Added `token::authority = agent_account.operator` on agent_token_account |
| M-3 | **FIXED** | Added `owner == global.fee_collector/solrep_pool` on fee destination accounts |
| M-4 | **FIXED** | Added `require!(epoch_id < u64::MAX)` guard |
| M-5 | **FIXED** | Replaced `as u64` with `u64::try_from().map_err()` |
| L-5 | **FIXED** | Replaced runtime `find_program_address` with `ctx.bumps.staker_vault` |
