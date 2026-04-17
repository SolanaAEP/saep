# Internal Security Audit — 2026-04-17

Scope: all 7 Anchor programs (`agent_registry`, `task_market`, `treasury_standard`, `fee_collector`, `proof_verifier`, `capability_registry`, `governance_program`).

Categories checked: PDA spoofing, signer/owner validation, arithmetic overflow, CPI safety, reentrancy, Token-2022 hook enforcement, account close/drain, Borsh deserialization, event emission, compute budget.

Continues from F-2026-13. Cross-references existing findings (F-2026-01 through F-2026-13) from `internal-audit-2026-04-16.md` and `internal-audit-2026-04-16-followup.md`.

---

## Previously Identified Findings — Status

| ID | Severity | Status | Notes |
|---|---|---|---|
| F-2026-01 | Critical | **CLOSED** | Civic gateway fail-close on `Pubkey::default()` verified in `personhood.rs:24-26` |
| F-2026-02 | Critical | **DEFERRED** | `reputation_cpi.rs` returns `ReputationBindingNotReady` unconditionally. `caller_guard` still typed as `Box<Account<'info, ReentrancyGuard>>` (not `UncheckedAccount`) — migration prerequisite before re-enabling |
| F-2026-03 | High | **CLOSED** | Reputation rail removed from `release.rs` |
| F-2026-04 | High | **CLOSED** | `caller_guard` switched to `UncheckedAccount` with manual owner/PDA/discriminator validation in `reputation.rs` and `verify_proof.rs` |
| F-2026-05 | High | **CLOSED** | `submit_result.rs` branches on `bid_book.is_some()`; `close_bidding.rs` rewrites `task.agent_did` to winner's DID |
| F-2026-06 | Medium | **CLOSED** | Verified |
| F-2026-07 | Medium | **CLOSED** | `close_bidding.rs` enforces `remaining.len() == reveal_count * 2`, dedup via `seen_bidders`, cancel path resets to `Funded` |
| F-2026-08 | Medium | **CLOSED** | `commit_bid.rs` runs `capability_check` |
| F-2026-09 | Low | **CLOSED** | `reveal_bid` now bounds `amount` to `(0, task.payment_amount]` |
| F-2026-10 | Low | **CLOSED** | Addressed by F-2026-16 fix: `close_bid` instruction added |
| F-2026-11 | Info | **OPEN** | `CategoryReputation` single-id replay check only |
| F-2026-12 | Low | **CLOSED** | `stack_height <= 2` check applied in both `reputation.rs` and `verify_proof.rs` |
| F-2026-13 | Medium | **CLOSED** | `close_bidding.rs` hard-rejects `!revealed || slashed` bids via `InvalidBidInEnumeration` |

---

## New Findings

### F-2026-14 — Inconsistent reentrancy guard in treasury_standard

**Severity:** Medium
**Category:** Reentrancy
**Affected files:**
- `programs/treasury_standard/src/instructions/withdraw.rs` (no guard)
- `programs/treasury_standard/src/instructions/fund_treasury.rs` (no guard)
- `programs/treasury_standard/src/instructions/init_stream.rs` (no guard)
- `programs/treasury_standard/src/instructions/close_stream.rs` (no guard)

**Description:**
`withdraw_earned` correctly enters/exits the reentrancy guard before CPI (Jupiter swap + token transfers). Four other instructions — `withdraw`, `fund_treasury`, `init_stream`, `close_stream` — all perform `transfer_checked` CPI calls but have no guard enter/exit.

Currently safe because these instructions transfer to/from program-controlled PDAs without external callback vectors (no Jupiter intermediary). However, if Token-2022 TransferHook is enabled on any accepted mint, the hook program receives control during `transfer_checked`, which creates a reentrancy window.

The hook allowlist check (`assert_hook_allowed_at_site`) mitigates this by rejecting unknown hooks, but the allowlist is trust-based — a previously-allowed hook program that is upgraded maliciously would bypass the allowlist while exploiting the missing guard.

**Recommendation:** Add `try_enter`/`guard_exit` around CPI calls in all four instructions, matching the `withdraw_earned` pattern. Defense-in-depth: the guard is cheap (~2 account reads/writes) and the pattern already exists in the same program.

---

### F-2026-15 — Unbounded `route_data` in withdraw_earned

**Severity:** Medium
**Category:** Borsh deserialization / Compute budget
**Affected file:** `programs/treasury_standard/src/instructions/withdraw_earned.rs:88`

**Description:**
`handler` accepts `route_data: Vec<u8>` with no `max_len` constraint. Borsh deserialization reads a 4-byte length prefix then allocates that many bytes from the transaction data. While Solana's 1232-byte transaction size limit caps the actual payload, a malicious caller can:

1. Fill the entire remaining transaction space with route_data, leaving minimal room for Jupiter's CPI instruction data — causing a confusing downstream error rather than a clean reject.
2. In future versioned-transaction or lookup-table contexts, larger payloads may become feasible.

More importantly, the `route_data` is passed directly as `data` in a raw CPI invoke to Jupiter (`jupiter.rs:29`). No validation of the route_data structure occurs before the CPI. If the Jupiter program ID is spoofed (currently prevented by `global.jupiter_program` check, but worth noting as a layered risk), arbitrary program invocation with arbitrary data becomes possible.

**Recommendation:** Add a `MAX_ROUTE_DATA_LEN` constant (e.g., 512 bytes) and reject if `route_data.len() > MAX_ROUTE_DATA_LEN`. Validate that `jupiter_program` is checked before CPI (already done — confirm in review).

---

### F-2026-16 — Bid PDA not closeable prevents re-bidding on re-opened tasks

**Severity:** Medium
**Category:** Account close/drain
**Affected files:**
- `programs/task_market/src/instructions/commit_bid.rs:38-45` (uses `init`, not `init_if_needed`)
- `programs/task_market/src/instructions/claim_bond.rs` (no `close` on Bid account)
- `programs/task_market/src/instructions/close_bidding.rs:176-181` (cancel path detaches bid_book, enabling re-open)

**Description:**
Extends F-2026-10. The cancel path in `close_bidding` sets `task.bid_book = None` and `task.status = Funded`, allowing the client to call `open_bidding` again. However, previous bidders' Bid PDAs (seeded `[SEED_BID, task_id, bidder]`) still exist on-chain. When a previous bidder calls `commit_bid` on the re-opened task, Anchor's `init` constraint fails because the PDA already exists.

This means any bidder who participated in a cancelled round is permanently excluded from future rounds on the same task. In a market with few qualified agents, this could make tasks unbiddable.

**Recommendation:** Either:
1. Add a `close_bid` instruction that reclaims the Bid PDA (requires the bid to be in `refunded` state), or
2. Change `commit_bid` to use `init_if_needed` with appropriate guards against double-bonding (check `bid.refunded == true` before re-initialization), or
3. Include a `bid_nonce` in the PDA seeds, incremented per bidding round (stored in BidBook).

Option 3 is cleanest — it preserves historical Bid accounts and avoids `init_if_needed` (which has its own audit surface).

---

### F-2026-17 — Stake transfers lack hook allowlist enforcement

**Severity:** Low
**Category:** Token-2022 hook enforcement
**Affected files:**
- `programs/agent_registry/src/instructions/register_agent.rs:152-160`
- `programs/agent_registry/src/instructions/stake.rs:63-71` (StakeIncrease)
- `programs/agent_registry/src/instructions/stake.rs:194-206` (WithdrawExecute)
- `programs/agent_registry/src/instructions/slash.rs:146-165` (ExecuteSlash)

**Description:**
All `transfer_checked` calls on `stake_mint` in agent_registry bypass hook allowlist checks. The `task_market` and `treasury_standard` programs consistently call `assert_hook_allowed_at_site` before every token transfer. agent_registry does not — it has no `HookAllowlist` account in any stake-related instruction context.

If `stake_mint` is a Token-2022 mint with a TransferHook, the hook program gains arbitrary execution during every stake deposit, withdrawal, and slash — without being vetted against the allowlist.

**Risk is partially mitigated** because `stake_mint` is set once in `init_global` by the authority (presumably a known, safe mint). But the allowlist pattern exists precisely because mint extensions can change post-deploy.

**Recommendation:** Add `HookAllowlist` as an optional account to stake-related instruction contexts. Define `SITE_STAKE_*` constants in fee_collector and enforce them before CPI. Alternatively, if stake_mint is guaranteed to be a basic SPL mint without hooks, assert this at `init_global` time by inspecting extensions (the `inspect_mint_extensions` function in fee_collector already does this).

**Status:** CLOSED — `init_global` now requires `stake_mint_info` account and rejects Token-2022 mints with TransferHook extension. SPL Token mints pass unconditionally (no extensions possible).

---

### F-2026-18 — set_civic_gateway_program allows reset to default

**Severity:** Low
**Category:** Signer/owner validation
**Affected file:** `programs/agent_registry/src/instructions/governance.rs:62-71`

**Description:**
`set_civic_gateway_program_handler` accepts any `Pubkey` including `Pubkey::default()`. Setting the gateway to `Pubkey::default()` re-enables the fail-close path in `assert_civic_token_owner` (personhood.rs:24-26), which unconditionally rejects all attestations. This effectively disables agent registration for any tier requiring personhood.

While the authority must sign, an accidental call with a zeroed argument or a governance proposal with the wrong payload would silently break the system. There is no confirmation step, no timelock, and no event distinguishing "intentional disable" from "mistake."

**Recommendation:** Add `require!(new_civic_gateway_program != Pubkey::default(), RegistryError::InvalidCivicGateway)`. If intentional disabling is needed, use a separate `disable_personhood` instruction with explicit naming and a distinct event.

**Status:** CLOSED — reject `Pubkey::default()` with `InvalidCivicGateway` error.

---

### F-2026-19 — O(n^2) duplicate detection in close_bidding

**Severity:** Low
**Category:** Compute budget
**Affected file:** `programs/task_market/src/instructions/close_bidding.rs:104-108`

**Description:**
Duplicate bidder detection uses a linear scan over `seen_bidders: Vec<Pubkey>` for each new bid. With `MAX_BIDDERS_PER_TASK = 64`, worst case is sum(1..64) = 2016 Pubkey comparisons (each 32 bytes). Total comparison data: ~64 KB.

At ~100 CU per comparison (conservative), this costs ~200k CU for the dedup loop alone, plus the Bid/Agent account deserialization and PDA re-derivation per pair. Combined with 128 remaining_accounts (64 pairs), this instruction may approach the 200k default CU limit or the 1.4M max.

**Bounded and unlikely to panic**, but worth benchmarking. A task with 50+ revealed bids hitting close_bidding could fail with ComputeExceeded.

**Recommendation:** Benchmark with 64 bids on localnet. If CU > 400k, consider:
1. Sorting `seen_bidders` and using binary search (O(n log n) total), or
2. Pre-sorting remaining_accounts by bidder pubkey and checking only adjacent pairs (O(n) total), with a require that they arrive sorted.

**Status:** ACCEPTED (M1) — bounded at 64 bidders, ~200k CU worst case is within 1.4M max. Most M1 tasks will have <10 bids. Revisit for M2 if bidder counts grow.

---

### F-2026-20 — HookRejected event emitted in warn-only path

**Severity:** Info
**Category:** Event emission
**Affected file:** `programs/fee_collector/src/hook.rs:81-87`

**Description:**
When `default_deny` is `false` (warn-only mode), `assert_hook_allowed_at_site` emits `HookRejected` before logging a warning and returning `Ok(())`. The transfer proceeds successfully despite the rejection event.

Indexers or monitoring systems that trigger alerts on `HookRejected` will produce false positives. The event name does not distinguish "rejected and blocked" from "flagged but allowed."

**Recommendation:** Emit a distinct `HookWarned` event in the warn-only path, or add a `blocked: bool` field to `HookRejected`.

---

### F-2026-21 — governance_program is empty stub

**Severity:** Info
**Category:** General
**Affected file:** `programs/governance_program/src/lib.rs`

**Description:**
`governance_program` contains a single `initialize` instruction that does nothing — no state, no authority checks, no logic. Deploying this program on devnet is harmless but it occupies a program ID that should be upgrade-authority-locked until M2 implementation.

**Recommendation:** Ensure the deploy keypair's upgrade authority is held by the multisig (or a single known authority). Do not reference this program ID in any CPI until M2 implementation lands.

---

## Per-Program Summary

### agent_registry
- **PDA spoofing:** Seeds well-formed. All PDAs use `has_one` or `seeds` constraints. `caller_guard` uses manual validation (F-2026-04 fix). Pass.
- **Signer/owner:** Authority-gated instructions use `has_one = authority`. Two-step authority transfer. `execute_slash` is permissionless (cranker) but timelock-gated. Pass.
- **Arithmetic:** All EWMA/stake math uses `checked_*`. `assert_slash_bound` prevents over-slash. Pass.
- **CPI safety:** Guard enter/exit on register, stake, reputation. `load_caller_guard` validates cross-program guard PDA (owner + seeds + discriminator). Pass.
- **Reentrancy:** Guard pattern consistent across all CPI paths. Pass.
- **Token-2022:** Hook enforcement missing on stake_mint transfers (F-2026-17).
- **Account close:** No accounts are closed. Acceptable for M1 (no rent reclamation needed yet).
- **Borsh:** Fixed-size accounts. No unbounded Vec fields. Pass.
- **Events:** Comprehensive. All state transitions emit events. Pass.
- **Compute:** No unbounded loops. Pass.
- **Additional:** F-2026-18 (civic gateway reset to default).

### task_market
- **PDA spoofing:** All PDA seeds correct. `close_bidding` re-derives Bid PDA and compares. `bid_book` constraint on `task.bid_book`. Pass.
- **Signer/owner:** Client-only ops check `task.client`. Cranker ops are permissionless but state-gated. Pass.
- **Arithmetic:** `compute_fees`, `compute_bond_amount` use `checked_*`. `bid_beats` is pure comparison. Pass.
- **CPI safety:** Guard on all fund-moving instructions. Hook allowlist checked before every `transfer_checked`. Pass.
- **Reentrancy:** Consistent guard pattern. Pass.
- **Token-2022:** Hook enforcement on all payment paths (fund, release, expire, commit_bid, claim_bond). Pass.
- **Account close:** `cancel_bidding` closes `bond_escrow` and `bid_book`. Individual `Bid` accounts never closed (F-2026-10, extended by F-2026-16).
- **Borsh:** `TaskPayload` uses enum variants with bounded arrays (`[u8; 32]`, fixed Vec via `MAX_*` constants). Pass.
- **Events:** All transitions emit. Pass.
- **Compute:** F-2026-19 (O(n^2) dedup in close_bidding).

### treasury_standard
- **PDA spoofing:** Seeds correct. `allowed_targets` and `allowed_mints` scoped to `agent_did`. Pass.
- **Signer/owner:** `has_one = operator` on treasury-scoped ops. `close_stream` allows client or operator. Pass.
- **Arithmetic:** Rollover, rate, earned, claimable — all `checked_*`. Oracle normalization uses `checked_mul`/`checked_div`. Pass.
- **CPI safety:** Jupiter CPI uses `global.jupiter_program` (authority-set). Pass.
- **Reentrancy:** Inconsistent (F-2026-14). `withdraw_earned` guarded; four other CPI instructions not.
- **Token-2022:** Hook enforcement on all paths. Pass.
- **Account close:** `close_stream` does not close the `PaymentStream` account (sets status only). Minor rent inefficiency.
- **Borsh:** F-2026-15 (`route_data: Vec<u8>` unbounded).
- **Events:** Comprehensive. Pass.
- **Compute:** Oracle reads and Jupiter CPI are CU-heavy but bounded. Pass.

### fee_collector
- **PDA spoofing:** `HookAllowlist` seeded on `[b"hook_allowlist"]`. `AgentHookAllowlist` seeded on `[b"agent_hook_allowlist", agent_did]`. Pass.
- **Signer/owner:** Authority-gated. Pass.
- **Arithmetic:** Bitfield ops, no overflow risk. Pass.
- **CPI safety:** No outgoing CPI. Library functions only. Pass.
- **Reentrancy:** N/A (no CPI). Pass.
- **Token-2022:** Core of hook enforcement logic. `get_transfer_hook_program_id` parses extension data correctly. `assert_hook_allowed_at_site` chains global → agent → default. Pass.
- **Account close:** N/A. Pass.
- **Borsh:** Fixed-size accounts. Pass.
- **Events:** F-2026-20 (HookRejected in warn-only path).
- **Compute:** Extension parsing is bounded by Token-2022 data layout. Pass.

### proof_verifier
- **PDA spoofing:** `VerifierKey` seeds include `key_id`. `BatchState` seeds include `batch_id`. `caller_guard` manually validated (F-2026-04). Pass.
- **Signer/owner:** VK rotation uses authority + timelock. `commit_vk` / `activate_vk` two-step. Pass.
- **Arithmetic:** `scalar_in_field` validates BN254 field membership. Batch accumulation uses field ops. Pass.
- **CPI safety:** `verify_proof` is a callee (no outgoing CPI in verify path). `reputation_cpi` has outgoing CPI but is permanently disabled (F-2026-02). Pass.
- **Reentrancy:** Guard on verify_proof. reputation_cpi guard type mismatch noted (F-2026-02 migration note). Pass.
- **Token-2022:** N/A. Pass.
- **Account close:** `abort_batch` closes batch state. Pass.
- **Borsh:** VK points are fixed-size arrays. Proof is 8 x `[u8; 32]`. Pass.
- **Events:** Comprehensive. Pass.
- **Compute:** Groth16 verification is CU-intensive (~200k per proof). Batch mode amortizes pairing. Bounded by `MAX_BATCH_SIZE = 10`. Pass.

### capability_registry
- **PDA spoofing:** `CapabilityTag` seeded on `[b"cap_tag", &bit_index.to_le_bytes()]`. `RegistryConfig` seeded on `[b"cap_config"]`. Pass.
- **Signer/owner:** Authority-gated. Pass.
- **Arithmetic:** `bit_mask` checks `bit_index < 128`. Bitshift is safe. Pass.
- **CPI safety:** No outgoing CPI. Pass.
- **Reentrancy:** N/A. Pass.
- **Token-2022:** N/A. Pass.
- **Account close:** N/A. Pass.
- **Borsh:** Fixed-size. `slug` validated with charset check. Pass.
- **Events:** Tag creation/update events present. Pass.
- **Compute:** Minimal. Pass.

### governance_program
- **Empty stub (F-2026-21).** No findings beyond ensuring upgrade authority is secured.

---

## Summary

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 3 | F-2026-14, F-2026-15, F-2026-16 |
| Low | 3 | F-2026-17, F-2026-18, F-2026-19 |
| Info | 2 | F-2026-20, F-2026-21 |

No new Critical or High findings. Previously identified Critical/High issues (F-2026-01 through F-2026-05) are all either CLOSED or DEFERRED (F-2026-02, with fail-close active).

### Post-audit fixes applied (same session)

- **F-2026-14 → CLOSED**: Added reentrancy guard (try_enter/guard_exit) to `withdraw`, `fund_treasury`, `init_stream`, `close_stream` in treasury_standard.
- **F-2026-15 → CLOSED**: Added `MAX_ROUTE_DATA_LEN = 512` constant and length check in `withdraw_earned` before CPI.
- **F-2026-16 → CLOSED**: Added `close_bid` instruction (bidder closes Bid PDA after refund) and `close_bid_book` instruction (client closes BidBook + BondEscrow after settlement). Fixed cancel path in `close_bidding` — no longer sets `task.bid_book = None` (was blocking claim_bond). Re-bidding lifecycle: close_bid → close_bid_book → open_bidding creates fresh PDAs.
