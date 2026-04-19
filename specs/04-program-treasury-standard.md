# Spec 04 — TreasuryStandard Program

**Owner:** anchor-engineer
**Depends on:** 03
**Blocks:** 07
**References:** backend PDF §2.1 (CU budgets: ~80K fund / ~60K stream-init / ~40K withdraw), §2.3 (full spec: PDA wallet, spending limits, streaming, Jupiter CPI), §2.6 (7-day timelock), §5.1 (Re-entrancy, Integer Safety, Token Safety, Oracle Safety)

## Goal

A per-agent PDA wallet that enforces spending limits at the instruction level and supports time-locked payment streams with Jupiter auto-swap at settlement. Client deposits, agent earns, limits are checked by the program — not the UI.

## State

### `TreasuryGlobal` PDA — singleton
- **Seeds:** `[b"treasury_global"]`
- **Fields:**
  - `authority: Pubkey`
  - `agent_registry: Pubkey` — program id
  - `jupiter_program: Pubkey` — Jupiter aggregator program
  - `allowed_mints: Pubkey` — pointer to `AllowedMints` PDA (simple whitelist)
  - `max_stream_duration: i64` — default 30 days
  - `default_daily_limit: u64` — governance-configurable guardrail; treasuries can override only within `max_daily_limit`
  - `max_daily_limit: u64`
  - `paused: bool`
  - `bump: u8`

### `AgentTreasury` PDA (per agent, per backend §2.3)
- **Seeds:** `[b"treasury", agent_did.as_ref()]`
- **Fields:**
  - `agent_did: [u8; 32]`
  - `operator: Pubkey`
  - `daily_spend_limit: u64` (USDC lamports)
  - `per_tx_limit: u64`
  - `weekly_limit: u64`
  - `spent_today: u64` — resets at UTC midnight
  - `spent_this_week: u64` — resets Monday UTC
  - `last_reset_day: i64` — unix day number
  - `last_reset_week: i64` — ISO week number
  - `streaming_active: bool`
  - `stream_counterparty: Option<Pubkey>`
  - `stream_rate_per_sec: u64`
  - `bump: u8`

### `TreasuryVault` PDA — per agent, per mint, SPL token account
- **Seeds:** `[b"vault", agent_did.as_ref(), mint.as_ref()]`
- Owned by program; holds USDC/SOL-wrapped/SAEP balances.

### `PaymentStream` PDA
- **Seeds:** `[b"stream", agent_did.as_ref(), counterparty.as_ref(), stream_nonce.as_ref()]`
- **Fields:**
  - `agent_did: [u8; 32]`
  - `client: Pubkey` — counterparty funding the stream
  - `payer_mint: Pubkey`
  - `payout_mint: Pubkey` — what the agent receives (may differ → Jupiter swap at `withdraw_earned`)
  - `rate_per_sec: u64` — in `payer_mint` units
  - `start_time: i64`
  - `max_duration: i64` — rejects `> global.max_stream_duration`
  - `deposit_total: u64` — `rate * max_duration`
  - `withdrawn: u64` — watermark in payer-mint units
  - `escrow_bump: u8`
  - `status: StreamStatus` — `Active | Closed`
  - `stream_nonce: [u8; 8]` — caller-supplied; backs the seeds enumeration above so concurrent streams between the same `(agent_did, counterparty)` pair derive distinct PDAs

### `StreamEscrow` PDA — SPL token account per stream
- **Seeds:** `[b"stream_escrow", stream.key().as_ref()]`

### `AllowedMints` PDA — simple Pubkey array (max 16)
- **Seeds:** `[b"allowed_mints"]`
- Populated by governance. M1 seeds: USDC-dev, SOL-wrapped, SAEP-mock.

**§State sweep-log (cycle 176).** Pre-edit block reflects `5bd33c1` initial M1 batch. Reconciled against scaffold ground truth at `programs/treasury_standard/src/state.rs` + `programs/treasury_standard/src/guard.rs`. Five surfaces diverge post pre-audit-01 call-target whitelist (`3c71455` / spec `3c8db4a`), pre-audit-05 hook-allowlist pointer (`b435db7` / spec `6004a6a`), and pre-audit-07 reentrancy-guard primitives (`c759a7b` / spec `88e60b1`):

- **Absent `TreasuryGlobal` fields (3):** `pending_authority: Option<Pubkey>` at `state.rs:23` (two-step authority slot; §Instructions line 142 `transfer_authority`/`accept_authority` umbrella implies it); `global_call_targets: Vec<Pubkey>` at `state.rs:35` (cap `MAX_GLOBAL_CALL_TARGETS = 8`; fallback whitelist when an agent has no `AllowedTargets` PDA; landed `3c71455`); `hook_allowlist: Pubkey` at `state.rs:39` (pointer to `fee_collector::HookAllowlist`; immutable once wired via `set_hook_allowlist_ptr`; landed `b435db7`).
- **Absent PDAs (3):** `AllowedTargets` at `state.rs:42-49` (per-agent override for `global_call_targets`; `agent_did` + `targets: Vec<Pubkey>` cap `MAX_CALL_TARGETS = 32` + `bump`; per-agent presence overrides global, empty per-agent list means "deny all"; landed `3c71455`). `ReentrancyGuard` at `guard.rs:11-19` (seeds `[b"guard"]`; 5 fields — `active` / `entered_by` / `entered_at_slot` / `reset_proposed_at` / `bump`; landed `c759a7b`; `try_enter`/`exit` wrap the 5 fund/withdraw/stream-write surfaces enumerated at §Events line 157). `AllowedCallers` at `guard.rs:21-27` (seeds `[b"allowed_callers"]`; `programs: Vec<Pubkey>` cap `MAX_ALLOWED_CALLERS = 8` + `bump`; authority-gated via `init_guard` / `set_allowed_callers`; landed `c759a7b`; admin-reset helper extracted in `cd5b594`).
- **Absent `AllowedMints` fields:** spec lines 66-68 describe "simple Pubkey array (max 16)" under a seeds stub; scaffold `state.rs:93-100` adds `authority: Pubkey` + explicit `mints: Vec<Pubkey>` (cap 16) + `bump`. Authority gates add/remove per §Events `AllowedMintAdded`/`Removed`.
- **Absent module-level constants (17):** `state.rs:5-17` — `MAX_ALLOWED_MINTS` / `MAX_CALL_TARGETS` / `MAX_GLOBAL_CALL_TARGETS` / `SECS_PER_DAY` / `SECS_PER_WEEK` / `DEFAULT_MAX_STREAM_DURATION` / `MAX_STALENESS_SECS = 60` / `MAX_CONFIDENCE_BPS = 100` / `DEFAULT_SLIPPAGE_BPS = 50` / `BPS_DENOM = 10_000` / `BASE_DECIMALS = 6` / `MAX_ROUTE_DATA_LEN = 512`; `guard.rs:5-9` — `SEED_GUARD` / `SEED_ALLOWED_CALLERS` / `MAX_ALLOWED_CALLERS = 8` / `MAX_CPI_STACK_HEIGHT = 3` / `ADMIN_RESET_TIMELOCK_SECS = 24h`. The staleness + confidence + slippage triad is load-bearing for §Security-checks "Oracle Safety"; the CPI-depth + timelock pair is load-bearing for §Security-checks "Re-entrancy".
- **Field-listing drift surfaced inline (not patched here):** `PaymentStream` spec Seeds line 49 enumerates `stream_nonce.as_ref()` but Fields list lines 50-61 omits the corresponding `stream_nonce: [u8; 8]` field; scaffold has it at `state.rs:89`. Surgical field-insert held as a separate §State-intro-refresh cycle candidate — append-only convention preserved.

**Guard-state-vocabulary matrix row (post-cycle):** treasury_standard = `2-PDA (ReentrancyGuard + AllowedCallers)` — no separate `GuardConfig` account (config lives on `AllowedCallers` directly; corrects cycle-175 next-options "3-PDA guard triplet" prediction). 5-program §State-sweep matrix: 2-of-5 M1-in-scope complete (capability_registry = `N/A`, treasury_standard = `2-PDA`). Pairs with cycle-163 §Events reconciliation (spec commit `4b07e06`) — §Events lines 157-159 surfaced the guard-admin ix family + `ReentrancyRejected` emit-site absence; this §State reconciliation lands the backing PDAs + constants so the two deltas blocks are a load-bearing pair.

### §State-intro-refresh (cycle 184, 2026-04-19)

Field-listing drift bullet held by cycle 176 (line 76 above) is now closed. `PaymentStream.stream_nonce: [u8; 8]` is enumerated in the Fields list at line 62, immediately after `status: StreamStatus`, matching the `state.rs:89` scaffold ordering. The seeds line 49 enumerates `stream_nonce.as_ref()` as the 4th seed component; the Fields entry now backs that seed without forcing a reviewer to cross-read the scaffold to discover it. Field placement preserves the convention "all explicit struct fields, then `bump`" used elsewhere in this spec — the trailing `bump: u8` remains implicit per §State convention (matches `TreasuryGlobal` / `AgentTreasury` / `TreasuryVault` field listings above which also omit their trailing bumps).

## Instructions

### `init_global(...)` — one-shot, deployer-signed.

### `init_treasury(agent_did, daily_spend_limit, per_tx_limit, weekly_limit)`
- **Signers:** `operator`
- **Validation:**
  - CPI-read `AgentRegistry::AgentAccount` for `(operator, agent_id)` where `agent.did == agent_did`, `status == Active`
  - `daily_spend_limit <= global.max_daily_limit`
  - `per_tx_limit <= daily_spend_limit <= weekly_limit`
  - `!global.paused`
- Creates `AgentTreasury`. No vaults yet — created lazily per mint.
- **Emits:** `TreasuryCreated`

### `fund_treasury(agent_did, mint, amount)`
- **Signers:** any funder (permissionless deposit)
- **Validation:** mint in `AllowedMints`, `amount > 0`, treasury exists.
- Creates `TreasuryVault` for `(did, mint)` if missing. Token-2022 `transfer_checked` from funder ATA to vault.
- **Emits:** `TreasuryFunded { agent_did, mint, amount, funder }`
- **CU target:** 80k (§2.1)

### `withdraw(agent_did, mint, amount, destination)`
- **Signers:** `operator`
- **Validation:**
  - Treasury + vault exist, `amount <= vault.balance`
  - `amount <= per_tx_limit`
  - Apply rollover: if `today > last_reset_day`, `spent_today = 0`; if new ISO week, `spent_this_week = 0`
  - `checked_add(spent_today, amount) <= daily_spend_limit`
  - `checked_add(spent_this_week, amount) <= weekly_limit`
  - **State written before CPI** (§5.1 re-entrancy)
- Token-2022 `transfer_checked` vault → `destination`.
- **Emits:** `TreasuryWithdraw`
- **CU target:** 40k

### `set_limits(agent_did, daily, per_tx, weekly)`
- **Signers:** `operator`. Same validation as `init_treasury`.

### `init_stream(agent_did, client, payer_mint, payout_mint, rate_per_sec, max_duration, stream_nonce)`
- **Signers:** `client`
- **Validation:**
  - `max_duration <= global.max_stream_duration`
  - `!treasury.streaming_active` (M1: at most one concurrent stream per treasury; reviewer may relax)
  - `payer_mint`, `payout_mint` both in `AllowedMints`
  - `rate_per_sec > 0`
- Creates `PaymentStream`, `StreamEscrow`. Transfers `deposit_total = rate * max_duration` (checked_mul, overflow-safe) from client to escrow.
- Sets `treasury.streaming_active = true`, `stream_counterparty = Some(client)`, `stream_rate_per_sec = rate_per_sec`.
- **Emits:** `StreamInitialized`
- **CU target:** 60k

### `withdraw_earned(stream)`
- **Signers:** `operator` (agent side)
- **Validation:** stream `Active`, `clock.now > stream.start_time`.
- `elapsed = min(now - start_time, max_duration)`
- `earned_total = checked_mul(rate_per_sec, elapsed)` clamped to `deposit_total`
- `claimable = earned_total - withdrawn`; require `claimable > 0`
- Writes `withdrawn = earned_total` BEFORE any CPI.
- If `payer_mint == payout_mint`: direct Token-2022 transfer escrow → agent vault.
- Else: Jupiter CPI swap `payer_mint → payout_mint` for `claimable`, min-out = `oracle_price * (1 - slippage_bps/10_000)` using Pyth/Switchboard price feed (staleness < 60s, confidence < 1% per §5.1). Deposit post-swap into agent vault.
- **Emits:** `StreamWithdrawn { claimable, swapped: bool }`

### `close_stream(stream)`
- **Signers:** either party (`client` or `operator`)
- Settles final `withdraw_earned` equivalent: agent gets unwithdrawn earned, client gets refund of `deposit_total - earned_total`.
- Clears `treasury.streaming_active`, counterparty, rate.
- **Emits:** `StreamClosed`

### `pay_task(agent_did, task_pda, mint, amount)` — invoked by TaskMarket
- **Signers:** TaskMarket program PDA (verified by program id equality + expected PDA derivation)
- Bypasses daily/weekly limits (task escrow is already governance-bounded), but still subject to `per_tx_limit`. Reviewer may tighten — see note.
- Moves funds vault → task escrow. Used for "treasury pays agent's sub-task" flows in M2; in M1 this remains in place but TaskMarket's M1 flow uses client-funded escrow directly, not treasury-funded.

### Governance setters
`add_allowed_mint`, `remove_allowed_mint`, `set_default_daily_limit`, `set_max_daily_limit`, `set_max_stream_duration`, `set_paused`, two-step `transfer_authority` / `accept_authority`.

## Events

Scaffold emits 14 of 15 declared events across 19 `emit!` call sites. Spec-vs-IDL drift: pre-edit list enumerated 10 events (the 7 sister-spec sweeps cycles 155–162 hit similar shape). Reconciled set below — IDL canonical.

**M1-emit inventory (14 events, 19 call sites)** grouped by concern, with provenance against `programs/treasury_standard/src/events.rs` + `instructions/`:

- *Global lifecycle (1):* `TreasuryGlobalInitialized` (init_global.rs:59) — `authority`, `agent_registry`, `jupiter_program`, `timestamp`. Program-global; no `agent_did` keying.
- *Per-agent treasury (3):* `TreasuryCreated` (init_treasury.rs:86), `TreasuryFunded` (fund_treasury.rs:115), `TreasuryWithdraw` (withdraw.rs:146 — carries `normalized_amount` USDC-equivalent post the cycle-22 decimal-normalization landing, in addition to raw `amount`).
- *Spend-limit governance (1):* `LimitsUpdated` (set_limits.rs:39).
- *Streams (3):* `StreamInitialized` (init_stream.rs:175 — carries `payer_mint` + `payout_mint` + `rate_per_sec` + `max_duration` + `deposit_total`), `StreamWithdrawn` (withdraw_earned.rs:272 — carries `claimable` + `swapped: bool` flag indicating Jupiter v6 swap leg fired), `StreamClosed` (close_stream.rs:181 — carries split `agent_receipts` + `client_refund` for prorated termination).
- *Swap (1):* `SwapExecuted` (withdraw_earned.rs:234, conditional on cross-mint stream payout) — carries `amount_in` / `amount_out` / `payer_mint` / `payout_mint` for Jupiter v6 CPI accounting (cycle 19 landing).
- *Allowlist surfaces (3):* `AllowedMintAdded` (allowed_mints.rs:35), `AllowedMintRemoved` (allowed_mints.rs:50) — both global; `AllowedTargetsUpdated` (allowed_targets.rs:51 + :93, dual-emit on add+remove) — per-agent override per spec §State `AgentTreasury.allowed_targets` invariant.
- *Pause (1):* `PausedSet` (governance.rs:50).
- *Reentrancy guard runtime (1 live, 1 struct-only):* `GuardEntered` fires on the 5 fund/withdraw/stream-write surfaces (fund_treasury.rs:71, withdraw.rs:63, withdraw_earned.rs:91, init_stream.rs:98, close_stream.rs:82). `ReentrancyRejected` is struct-only at events.rs:122; no emit site at M1 — same scaffold-parity placeholder pattern that `program-fee-collector.md` / `program-nxs-staking.md` / `program-dispute-arbitration.md` carry. The reject path at `guard::check_callee_preconditions` returns `TreasuryError::ReentrancyDetected` (errors-only), no event yet.

**Guard-admin events absent — distinguishing from agent_registry.** The `instructions/guard.rs` module exposes 4 admin ixs (`init_guard`, `set_allowed_callers`, `propose_guard_reset`, `admin_reset_guard`) with the standard 24h reset timelock (`guard.rs:9 ADMIN_RESET_TIMELOCK_SECS = 86_400`) — but unlike `agent_registry`'s live `GuardInitialized` / `GuardAdminReset` / `AllowedCallersUpdated` (cycle 161), treasury_standard does not declare or emit those events. Indexer-side, guard-admin state changes are visible only via post-emit account reads on `ReentrancyGuard` + `AllowedCallers` PDAs. Flagged for the cross-spec guard-event-vocabulary normalization candidate.

**Field-carrying:** 9 of 14 emitted events carry `agent_did: [u8; 32]` (the 7 per-agent surfaces + AllowedTargetsUpdated + SwapExecuted). 4 are program-scoped (TreasuryGlobalInitialized, AllowedMintAdded/Removed, PausedSet) and key on mint or authority. `GuardEntered` keys on `(program, caller, slot, stack_height)` — no `agent_did`, no `timestamp`; uses `slot: u64` instead per the cycles 157/158/159/160/161 guard-runtime convention. 13 of 14 carry `timestamp: i64`; only `GuardEntered` substitutes `slot`. No `slot` field on the 13 timestamp-carrying events. Fee-bps / treasury-spend-bucket fields N/A — fee splitting lives in `fee_collector` (cycle 157 spec), not here.

## Errors

`Unauthorized`, `Paused`, `MintNotAllowed`, `LimitExceeded`, `InsufficientVault`, `StreamAlreadyActive`, `StreamNotActive`, `StreamAlreadyClosed`, `InvalidDuration`, `InvalidRate`, `OracleStale`, `OracleConfidenceTooWide`, `SwapSlippage`, `ArithmeticOverflow`, `CallerNotTaskMarket`, `AgentNotActive`, `InvalidLimits`.

## CU budget (§2.1 targets; M1 default, reviewer may tighten)

| Instruction | Target |
|---|---|
| `fund_treasury` | 80k |
| `init_stream` | 60k |
| `withdraw` | 40k |
| `withdraw_earned` (no swap) | 60k |
| `withdraw_earned` (Jupiter swap) | 180k |
| `close_stream` | 70k |
| `set_limits` | 10k |

## Invariants

1. `sum(TreasuryVault balances across all mints) + escrowed stream balance == sum(fund - withdraw) ever` (no value leak).
2. `spent_today <= daily_spend_limit` and `spent_this_week <= weekly_limit` at every instruction boundary after rollover.
3. `withdrawn <= earned_at_now <= deposit_total` for every stream.
4. `streaming_active == (stream_counterparty.is_some() && active PaymentStream exists)` — bijection.
5. After `close_stream`, agent+client receipts sum to `deposit_total`.
6. Jupiter swap never proceeds if oracle staleness > 60s or confidence > 1% (§5.1).
7. `per_tx_limit <= daily_spend_limit <= weekly_limit` always.

## Security checks (backend §5.1)

- **Re-entrancy (critical here):** `spent_today`, `spent_this_week`, `withdrawn`, `streaming_active` all updated **before** any Token-2022 or Jupiter CPI. No program re-enters TreasuryStandard from Jupiter (Jupiter has no callback into our program; still, we explicitly do not export any entrypoint reachable via account-mutation on swap).
- **Account Validation:** all PDAs derived via Anchor `seeds + bump`. Vault ownership asserted = program. TaskMarket caller verified by program-id + expected PDA.
- **Integer Safety:** `checked_add/mul/sub` on all balance, spend, earned arithmetic. `rate * max_duration` checked for overflow at `init_stream`. `rate * elapsed` checked at `withdraw_earned`.
- **Oracle Safety:** Jupiter min-out derived from Pyth/Switchboard with staleness + confidence + `status == Trading` checks per §5.1.
- **Token Safety:** Token-2022 `transfer_checked` everywhere. M1 whitelist excludes mints with TransferHook or ConfidentialTransfer extensions; `AllowedMints` add path validates extension set on insert.
- **Authorization:** operator vs client vs TaskMarket-PDA distinguished on every handler. Limits cannot be raised above `global.max_daily_limit`.
- **Slashing Safety:** N/A here.
- **Upgrade Safety:** Squads 4-of-7, 7-day timelock (§2.6).
- **Pause:** blocks deposits, withdrawals, stream init; `close_stream` remains available so paused state cannot trap funds.

## Open questions for reviewer

- Whether `pay_task` should exist at all in M1 or be deferred. Current spec keeps the handler but TaskMarket M1 does not call it.
- Whether streams should allow top-up (M2 feature).
- `max_stream_duration` default — 30 days is a guess; governance can tune.

## Done-checklist

- [ ] Handlers + accounts compile, clippy clean
- [ ] Unit tests: limit rollover across UTC midnight, ISO week boundary
- [ ] Unit tests: overflow attempts on `rate * max_duration` and `rate * elapsed` reject cleanly
- [ ] Integration test: fund → withdraw within limits OK; exceeding per-tx rejects; daily cap rejects
- [ ] Integration test: init_stream → time warp 1h → withdraw_earned yields correct amount
- [ ] Integration test: withdraw_earned with mismatched mints triggers Jupiter CPI and respects slippage
- [ ] Integration test: stale oracle rejects swap
- [ ] Integration test: close_stream refunds client correctly
- [ ] Re-entrancy audit: every CPI call site inspected; state-before-CPI invariant documented per handler
- [ ] CU measurements logged in `reports/04-treasury-standard-anchor.md`
- [ ] IDL at `target/idl/treasury_standard.json`
- [ ] Security auditor pass against §5.1; findings closed
