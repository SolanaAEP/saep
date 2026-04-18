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

### `StreamEscrow` PDA — SPL token account per stream
- **Seeds:** `[b"stream_escrow", stream.key().as_ref()]`

### `AllowedMints` PDA — simple Pubkey array (max 16)
- **Seeds:** `[b"allowed_mints"]`
- Populated by governance. M1 seeds: USDC-dev, SOL-wrapped, SAEP-mock.

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

`TreasuryCreated`, `TreasuryFunded`, `TreasuryWithdraw`, `LimitsUpdated`, `StreamInitialized`, `StreamWithdrawn`, `StreamClosed`, `AllowedMintAdded`, `AllowedMintRemoved`, `PausedSet`.

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
