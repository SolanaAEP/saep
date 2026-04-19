# Spec 07 — TaskMarket Program

**Owner:** anchor-engineer
**Depends on:** 03, 04, 06
**Blocks:** 08 (indexer needs TaskMarket IDL), 10 (portal marketplace), 12 (e2e)
**References:** backend PDF §2.1 (CU budgets: ~120K create, ~80K submit, ~400K verify+settle), §2.4 (full spec, state machine, Groth16 integration), §2.6 (14-day timelock — critical path), §5.1 (Re-entrancy, Integer Safety, Token Safety, Account Validation)

## Goal

On-chain task escrow and lifecycle. A client creates a task with committed hash + deadline + escrowed payment; an assigned agent submits a result hash + proof reference; ProofVerifier confirms the Groth16 proof; funds release to the agent minus protocol fee and SolRep fee. Expired tasks refund the client. Disputed tasks park state for DisputeArbitration (wired in M2; M1 stubs the `Disputed` transition).

Jito bundle support: `create_task` + `fund_task` intended to ship atomically so a funded task either fully exists or does not — ordering handled by the client submitting both instructions in one Jito bundle.

## State

### `MarketGlobal` PDA — singleton
- **Seeds:** `[b"market_global"]`
- **Fields:**
  - `authority: Pubkey`
  - `agent_registry: Pubkey`
  - `treasury_standard: Pubkey`
  - `proof_verifier: Pubkey`
  - `fee_collector: Pubkey` — stubbed M1, set to authority
  - `solrep_pool: Pubkey` — stubbed M1
  - `protocol_fee_bps: u16` — 10 (0.10%) per §2.4
  - `solrep_fee_bps: u16` — 5 (0.05%)
  - `dispute_window_secs: i64` — 86_400 (24h) per §2.4
  - `max_deadline_secs: i64` — 30 days default
  - `allowed_payment_mints: [Pubkey; 8]` — USDC-dev, SOL-wrapped, SAEP-mock seeded
  - `paused: bool`
  - `bump: u8`

### `TaskContract` PDA (per backend §2.4)
- **Seeds:** `[b"task", client.as_ref(), task_nonce.as_ref()]` where `task_nonce: [u8; 8]`
- **Fields:**
  - `task_id: [u8; 32]` — `= Poseidon2(client || task_nonce || created_at)`
  - `client: Pubkey`
  - `agent_did: [u8; 32]`
  - `payment_mint: Pubkey`
  - `payment_amount: u64`
  - `protocol_fee: u64` — computed at create
  - `solrep_fee: u64`
  - `task_hash: [u8; 32]` — Poseidon2 of task description (client-provided)
  - `result_hash: [u8; 32]` — set on submit
  - `proof_key: [u8; 32]` — IPFS/Arweave CID of the proof blob, or 0 until submit
  - `criteria_root: [u8; 32]` — Merkle root of success criteria, matches circuit public input
  - `milestone_count: u8` — 0 = single payment; 1..=8 allowed in M1
  - `milestones_complete: u8`
  - `status: TaskStatus`
  - `created_at: i64`
  - `funded_at: i64`
  - `deadline: i64`
  - `submitted_at: i64`
  - `dispute_window_end: i64` — set at verify time = `deadline + dispute_window_secs`
  - `verified: bool`
  - `bump: u8`

### `TaskStatus`
```
enum TaskStatus {
    Created,            // created, not yet funded
    Funded,             // escrow holds payment
    InExecution,        // agent acknowledged; optional intermediate — M1 may skip
    ProofSubmitted,     // result_hash + proof_key written
    Verified,           // ProofVerifier returned Ok
    Released,           // funds paid out
    Expired,            // past deadline, refunded
    Disputed,           // client raised dispute in window (M2 wires DisputeArbitration)
    Resolved,           // terminal after dispute (M2)
}
```

### `TaskEscrow` PDA — SPL token account per task
- **Seeds:** `[b"task_escrow", task.key().as_ref()]`

## State machine

```
Created --(fund_task)--> Funded --(submit_result)--> ProofSubmitted
                                                      |
                                                      (verify_task: CPI proof_verifier)
                                                      v
                                                   Verified --(release)--> Released
                                                      |
                                                      (raise_dispute within window)
                                                      v
                                                   Disputed --(M2: arbitrate)--> Resolved

Funded --(expire after deadline + grace)--> Expired
```

Invariant: no transition skips. Every edge is an explicit instruction. `Released`, `Expired`, `Resolved` are terminal.

## Instructions

### `init_global(...)` — one-shot, deployer-signed.

### `create_task(task_nonce, agent_did, payment_mint, payment_amount, task_hash, criteria_root, deadline, milestone_count)`
- **Signers:** `client`
- **Validation:**
  - `!global.paused`
  - `payment_mint ∈ allowed_payment_mints`
  - `payment_amount > 0`
  - `deadline > now + 60` (minimum 1-minute future)
  - `deadline <= now + max_deadline_secs`
  - `milestone_count <= 8`
  - CPI-read `AgentRegistry::AgentAccount` for `agent_did`, require `status == Active`
  - Compute fees: `protocol_fee = floor(amount * protocol_fee_bps / 10_000)`, `solrep_fee = floor(amount * solrep_fee_bps / 10_000)`, using `u128` intermediate for overflow safety
- **State transition:** creates `TaskContract` with `status = Created`. Does NOT move funds. Leaves `TaskEscrow` uninitialized until `fund_task`.
- **Emits:** `TaskCreated { task_id, client, agent_did, payment_amount, deadline }`
- **CU target:** 120k (§2.1)

### `fund_task(task_nonce)`
- **Signers:** `client`
- **Validation:** task exists, `status == Created`, `!global.paused`
- **State transition:** initializes `TaskEscrow` token account; Token-2022 `transfer_checked` from client's ATA of `payment_mint` → escrow for `payment_amount + protocol_fee + solrep_fee`. Wait — per §2.4, fees are deducted from `payment_amount` at settle, not added; aligning: escrow holds `payment_amount` total, fees are split-outs from that pool. **Decision (M1 default, reviewer may tighten):** escrow holds full `payment_amount`; at settle, `protocol_fee` and `solrep_fee` are deducted from the agent's payout and sent to `fee_collector` / `solrep_pool`. Client pays `payment_amount` gross.
- Sets `status = Funded`, `funded_at = now`.
- **Emits:** `TaskFunded`

### **Atomic create+fund via Jito bundle**

Client-side: both instructions in one versioned tx submitted as a Jito bundle. Program does not enforce atomicity (instruction-order is a client concern); it does validate that `fund_task` immediately follows `create_task` semantics by requiring `status == Created`. If the bundle partial-lands (only `create_task`), the task sits in `Created` status. Orphan cleanup:

### `cancel_unfunded_task(task_nonce)`
- **Signers:** `client`
- **Validation:** `status == Created`, `now >= created_at + 300` (5 min grace — prevents MEV-style immediate cancellation during bundle retry)
- Closes `TaskContract`, reclaims rent to client.

### `submit_result(task_nonce, result_hash, proof_key)`
- **Signers:** `operator` of the assigned agent (verified by CPI-reading `AgentAccount` for matching `agent_did`, `status == Active`)
- **Validation:**
  - `status == Funded`
  - `now <= deadline`
  - `result_hash != 0`
- **State transition:** writes `result_hash`, `proof_key`, `submitted_at = now`, `status = ProofSubmitted`.
- **Emits:** `ResultSubmitted`
- **CU target:** 80k (§2.1)

### `verify_task(task_nonce, proof_a, proof_b, proof_c)`
- **Signers:** any (permissionless — usually the proof-gen service)
- **Validation:** `status == ProofSubmitted`
- **CPI:** `ProofVerifier::verify_proof(proof_a, proof_b, proof_c, public_inputs)` where public inputs are constructed in locked order per spec 06: `[task_hash, result_hash, deadline, submitted_at, criteria_root]`.
- **State transition:** on Ok → `status = Verified`, `verified = true`, `dispute_window_end = deadline + dispute_window_secs`. On Err → status unchanged; event emitted for debugging.
- **Emits:** `TaskVerified` or `VerificationFailed`
- **CU target:** ~400k with the bn254 pairing; runs in its own tx with explicit compute-budget instruction. Settle is a separate call.

### `release(task_nonce)`
- **Signers:** any (permissionless crank)
- **Validation:**
  - `status == Verified`
  - `now >= dispute_window_end` (client had their 24h window to dispute)
  - `!global.paused`
- **State transition (state-before-CPI per §5.1):** set `status = Released`. Then:
  - `agent_payout = payment_amount - protocol_fee - solrep_fee` via `checked_sub`
  - Token-2022 `transfer_checked` escrow → agent operator ATA for `agent_payout`
  - Token-2022 `transfer_checked` escrow → `fee_collector` ATA for `protocol_fee`
  - Token-2022 `transfer_checked` escrow → `solrep_pool` ATA for `solrep_fee`
  - Close escrow account to zero (sanity check: residual must be 0)
  - CPI `AgentRegistry::record_job_outcome` with `success=true, disputed=false` and quality metrics derived from `criteria_root` coverage (M1 default: all-true since verification passed)
- **Emits:** `TaskReleased { agent_payout, protocol_fee, solrep_fee }`

### `expire(task_nonce)`
- **Signers:** any (permissionless crank)
- **Validation:** `status ∈ {Funded, ProofSubmitted}` AND `now > deadline + 3600` (1h grace so a verify attempt can complete around the boundary)
- **State transition:** `status = Expired`, refund full `payment_amount` to client, close escrow.
- CPI `AgentRegistry::record_job_outcome` with `success=false, disputed=false` — counts as a missed job.
- **Emits:** `TaskExpired`

### `raise_dispute(task_nonce)`
- **Signers:** `client`
- **Validation:** `status == Verified`, `now < dispute_window_end`
- **State transition:** `status = Disputed`. **M1:** freezes the escrow; DisputeArbitration wiring is M2. The field is reserved so M2 can add `arbitrate(...)` without a breaking state-machine change.
- **Emits:** `DisputeRaised`

### `set_allowed_mint`, `set_fees` (with reasonable bps caps), `set_paused`, authority two-step.

### Scaffold-vs-spec §Instructions deltas

Cycle-167 reconciliation of spec enumeration vs actual `programs/task_market/src/instructions/` (29 `pub fn *_handler` across 23 ix modules). Largest delta across the 5 M1-in-scope programs — spec enumerates ~11 explicit ix + "authority two-step" mention, scaffold ships 23 ix modules split across 8 concerns.

**Absent blocks (4 concerns, 15 ixs missing from spec enumeration):**

- **bidding block — 8 ixs across 8 modules (`open_bidding.rs:54` / `commit_bid.rs:112` / `reveal_bid.rs:36` / `close_bidding.rs:39` / `cancel_bidding.rs:44` / `claim_bond.rs:71` / `close_bid.rs:34` / `close_bid_book.rs:44`).** Commit-reveal scheme per cycle-74 audit report (`reports/task-market-audit.md`) — `open_bidding(commit_secs, reveal_secs, bond_bps)` opens the bid book on a `Funded` task; `commit_bid(commit_hash, agent_did)` keccak-hashed bid commitment gated by AgentRegistry active-status + capability-mask mirror (F-2026-08); `reveal_bid(amount, nonce)` decommit + low-bid tracking; `close_bidding` tallies winner + routes escrow delta refund to client; `cancel_bidding` pre-commit-window abort path; `claim_bond` post-terminal bond-refund / slash-on-no-reveal (fires `BidSlashed` on slash branch only per §Events bidding row); `close_bid` + `close_bid_book` post-terminal PDA-reclaim. Pre-edit §Events already documents the 6 bidding events (`BidBookOpened` / `BidCommitted` / `BidRevealed` ×2 dual-emit / `BidBookClosed` / `BidSlashed`) on line 186; §Instructions is where the ix surface needs to land. Cross-cite: cycle-74 audit report §Instructions-by-concern bucket "Bidding" + §Events dual-emit provenance for the 2 `BidRevealed` branches. Spec §Invariants (lines 219–228) does not reference the bidding state machine — the bid-book lifecycle (`bid_book.is_some() ⇒ phase ∈ {Settled}` per cycle-74 invariant 10) is scaffold-only; invariants-sweep cycle queued.

- **guard-admin block — 4 ixs in `guard.rs:42` / :75 / :105 / :125.** `init_guard(initial_callers: Vec<Pubkey>)` + `set_allowed_callers(programs: Vec<Pubkey>)` + `propose_guard_reset()` + `admin_reset_guard()`. Same 24h `ADMIN_RESET_TIMELOCK_SECS` pattern treasury_standard (cycle 163) + dispute_arbitration (cycle 166) carry. Guard-vocabulary cohort parity: task_market matches the treasury_standard / dispute_arbitration convention — guard-admin ixs live without event emission (no `GuardInitialized` / `GuardAdminReset` / `AllowedCallersUpdated` events, per §Events line 179). Indexer observes guard-admin state via `ReentrancyGuard` + `AllowedCallers` account reads only.

- **`disputed_timeout_refund(ctx)` — `disputed_timeout_refund.rs:56`, permissionless cranker-signed.** Secondary expiry surface for `status == Disputed` tasks that cross `dispute_window_end + DISPUTE_TIMEOUT_SECS` without DisputeArbitration resolution (M1 inert-surface — DisputeArbitration `execute_dispute_verdict` / `force_release` land M2 per cycle-74 audit report). Refunds full `payment_amount` to client, closes escrow, emits `TaskExpired` (dual-emit with `expire.rs:166` per §Events line 183). Absence from spec enumeration is the load-bearing omission — reviewer cross-reading §raise_dispute (line 172 "freezes the escrow; DisputeArbitration wiring is M2") without finding `disputed_timeout_refund` would assume disputed tasks are indefinitely frozen at M1; the scaffold actually provides the escrow-exit via the 1h grace + DISPUTE_TIMEOUT_SECS timeout path.

- **`allow_payment_mint(slot: u8)` — `allow_payment_mint.rs:47`, authority-signed.** Distinct from `set_allowed_mint` (spec line 175). `set_allowed_mint` writes `global.allowed_payment_mints[slot]` directly as a governance override. `allow_payment_mint` runs the full Token-2022 mint-extension sanity-check battery via `inspect_mint_extensions` (no TransferFee unless authority-held + no `default_state_frozen` + no PermanentDelegate + TransferHook program-id ∈ HookAllowlist) + allocates a per-mint `mint_accept` PDA (`MintAccept` record with `mint_accept_flags: u32` bitmask + `hook_program: Option<Pubkey>` + `accepted_at_slot` + `accepted_at_ts`) + emits `MintAccepted` (§Events mint-allowlist bucket line 187). Two paths by design: `set_allowed_mint` is the pre-launch bootstrap / emergency-override surface; `allow_payment_mint` is the production per-mint audit surface. Scaffold pattern mirrors treasury_standard's `allowed_mints` lane (cycle 163). Spec §fund_task mint-allowlist validation (line 102 "`payment_mint ∈ allowed_payment_mints`") hides the distinction — the allowlist surface is two-ix, not one.

- **`set_hook_allowlist_ptr(hook_allowlist: Pubkey)` — `governance.rs:65`, authority-signed.** Points `global.hook_allowlist` at a `HookAllowlist` PDA carrying the set of Token-2022 TransferHook program-ids permitted to be attached to allowed payment mints. Consumed by `allow_payment_mint` (above) + `commit_bid` (F-2026-08 hook-allowlist check per `commit_bid.rs:106`). Absent from spec §init_global params + spec §governance setter enumeration. Cross-cite: `reports/task-market-audit.md` §Governance-surface bucket + §Events `MintAccepted.hook_program` shape.

**Arg-shape drift (1 class, 1 ix):**

- **`create_task` §line 98 spec arg `task_hash` → scaffold `payload: TaskPayload`.** `create_task.rs:54` signature is `(task_nonce, agent_did, payment_mint, payment_amount, payload: TaskPayload, criteria_root, deadline, milestone_count)`. `TaskPayload` is a discriminated-union per cycle-74 audit report §Payload bucket (`kind_discriminant: u8` + `capability_bit: u16` + body fields). The on-chain `TaskContract.task_hash` field (spec §State line 43) is **computed** from the payload at create-time via `Poseidon2(TaskPayload.canonical_bytes)`, not passed as an arg. Spec arg-name `task_hash` is aspirational from pre-payload spec iteration. Second-emit behavior: `create_task` fires `TaskCreated` + `TaskPayloadStored` (§Events line 188 line-by-line cross-cite), which is load-bearing for indexers — a reviewer cross-reading spec line 110 "Emits: TaskCreated" only would miss the discriminated-union storage event. §Events already reconciled cycle 164; §Instructions-side arg-shape reconciliation lands here.

**Fictional line tail (1):**

- **Spec line 175 tail "authority two-step."** Unlike dispute_arbitration cycle 166 (where the tail had zero backing), task_market's `authority two-step` **is real code** — `authority.rs:18` (`transfer_authority_handler(new_authority: Pubkey)`) + `authority.rs:33` (`accept_authority_handler()`). Pending-authority two-step lives in `MarketGlobal.pending_authority: Option<Pubkey>`. The drift here is enumeration, not existence: the spec mentions the pattern by name but does not enumerate the two ix headings. Reviewer cross-reading the spec against the IDL will find both ixs, no surprise — but the handler-file cross-reference is worth the explicit callout for an audit-fix-manifest trail.

**Handler-file density cross-check:** 29 `pub fn *_handler` + `pub fn handler` signatures across 23 ix modules (vs dispute_arbitration's 23 handlers across 7 modules cycle 166; largest-surface M1 program by a 3× margin). Post-edit spec enumeration covers 11 explicit ix + 8 bidding + 4 guard-admin + `disputed_timeout_refund` + `allow_payment_mint` + `set_hook_allowlist_ptr` + `transfer_authority` + `accept_authority` = 27. Two-ix gap vs 29-handler count closes on the observation that `init_global`'s handler is `init_global::handler` (not a distinct `init_global_handler`-named fn) and the spec's `set_allowed_mint` / `set_fees` / `set_paused` share the `GovernanceUpdate` accounts struct (3 handlers, 3 spec names — already enumerated in line 175).

## Events

`programs/task_market/src/events.rs` declares 21 `#[event]` structs; 20 fire from 31 `emit!` sites across 15 instruction modules, and `ReentrancyRejected` is a struct-only scaffold-parity placeholder (same convention as fee_collector / nxs_staking / dispute_arbitration / governance guard-runtime variants) — the `guard::check_callee_preconditions` reject path returns `TaskMarketError::ReentrancyDetected` by error, no event. Guard-vocabulary coverage is 2-of-5 live (`GuardEntered` + `ReentrancyRejected` struct-only); the 3 guard-admin events (`GuardInitialized`, `GuardAdminReset`, `AllowedCallersUpdated`) are absent from both struct and emit — the `instructions/guard.rs` guard-admin ixs (init / set_allowed_callers / propose_guard_reset / admin_reset_guard) land without event emission, and post-emit state is observable only via `ReentrancyGuard` + `AllowedCallers` account reads. Agent_registry remains the only in-scope program with the full 5-of-5 live guard vocabulary (cycle 161).

Emit inventory by concern (8 buckets: global / task lifecycle / settlement / dispute / bidding / mint allowlist / payload / guard-runtime):
- **global** — `GlobalInitialized` (init_global.rs:69); `GlobalParamsUpdated` ×4 (governance.rs:28 / :50 / :79 — one site per setter + allow_payment_mint.rs:112 reusing the event on the mint-allowlist-add path); `PausedSet` (governance.rs:58).
- **task lifecycle** — `TaskCreated` (create_task.rs:136); `TaskFunded` (fund_task.rs:100); `TaskCancelled` (cancel_unfunded_task.rs:33); `TaskExpired` ×2 (expire.rs:166 + disputed_timeout_refund.rs:122 — dual-emit flags two distinct expiry surfaces, client-initiated 1h-grace expiry vs dispute-timeout forced refund).
- **settlement** — `ResultSubmitted` (submit_result.rs:87); `TaskVerified` (verify_task.rs:140, carries `dispute_window_end`); `VerificationFailed` (verify_task.rs:124 — status unchanged per spec-07 verify_task semantics); `TaskReleased` (release.rs:215, carries `agent_payout` + `protocol_fee` + `solrep_fee` split triple).
- **dispute** — `DisputeRaised` (raise_dispute.rs:28). Terminal hand-off per `audit-package-m1.md` §6.5 — `raise_dispute` is a named-stub family at M1 pending M2 DisputeArbitration `execute_dispute_verdict` / `force_release` landing.
- **bidding** (commit-reveal scheme per cycle-74 audit report) — `BidBookOpened` (open_bidding.rs:113); `BidCommitted` (commit_bid.rs:209); `BidRevealed` ×2 (reveal_bid.rs:69 + :89 — dual-emit matches the two reveal branches, bidder-signed decommit vs operator-delegated reveal); `BidBookClosed` (close_bidding.rs:181, carries `winner_agent: Option<Pubkey>` + `winner_amount` + `reveal_count: u16`); `BidSlashed` (claim_bond.rs:157 — fires only on the no-reveal-slash branch).
- **mint allowlist** — `MintAccepted` (allow_payment_mint.rs:105, carries `accept_flags: u32` bitmask + `hook_program: Option<Pubkey>` for TransferHook-mint detection per spec-07 hook-allowlist).
- **payload** — `TaskPayloadStored` (create_task.rs:144 — second emit from `create_task` after `TaskCreated`, carries `kind_discriminant: u8` + `capability_bit: u16` for the discriminated-union TaskPayload surface).
- **guard-runtime** — `GuardEntered` ×7 (expire / submit_result / close_bidding / verify_task / disputed_timeout_refund / release / fund_task — every ix that crosses `guard::check_callee_preconditions`; `create_task` omits guard-entry per its lack of CPI-out surface).

Field-carrying shape against actual struct bodies:
- **`task_id: [u8; 32]` on 15 of 21** — absent from `GlobalInitialized`, `GlobalParamsUpdated`, `PausedSet` (program-scoped), `MintAccepted` (keyed on `mint`), `GuardEntered` + `ReentrancyRejected` (guard-runtime, keyed on `(program, caller, slot)`).
- **`timestamp: i64` on 12 of 21** — absent from all 5 bidding events, `TaskPayloadStored` (keyed on task_id + ix-context), `GuardEntered` + `ReentrancyRejected` (substitute `slot: u64` per the cycles 157–163 guard-runtime convention). `MintAccepted` uniquely carries both `slot` and `timestamp`.
- **`slot: u64` on 3 of 21** — `GuardEntered`, `ReentrancyRejected`, `MintAccepted`.
- **`agent_did: [u8; 32]` on 2 of 21** — `TaskCreated` (bind at create-time from the matched AgentAccount) and `TaskReleased` (settle-path indexer join against AgentRegistry). Mid-lifecycle events key on `task_id` alone; indexer re-derives `agent_did` via `TaskContract.agent_did` post-read.
- **Settlement-fee triple on `TaskReleased`** — full `agent_payout` + `protocol_fee` + `solrep_fee` split per spec §fund_task escrow-fee-deduction decision. Consistent with the `compute_fees` property-test surface (cycle 76: no silent zero-fee bypass on bps arithmetic).

Pre-edit spec listed 10 event names with the claim "all events carry `task_id` and `timestamp`" — 11 additional events ship in the IDL (5 bidding + `GlobalInitialized` + `TaskCancelled` + `TaskPayloadStored` + `MintAccepted` + `GuardEntered` + `ReentrancyRejected`), `task_id` is absent from 6 of 21, and `timestamp` is absent from 9 of 21. Indexer-side reconstruction of per-task history uses the `(task_id, slot, ix_index)` composite from `program_events` rather than `(task_id, timestamp)` alone.

## Errors

`Unauthorized`, `Paused`, `MintNotAllowed`, `InvalidAmount`, `InvalidDeadline`, `DeadlineTooFar`, `AgentNotActive`, `WrongStatus`, `DeadlinePassed`, `DisputeWindowClosed`, `DisputeWindowOpen`, `NotExpired`, `EscrowMismatch`, `ArithmeticOverflow`, `ProofInvalid`, `CallerNotOperator`, `TaskNotFound`, `FeeBoundExceeded`.

## CU budget (§2.1 targets; M1 default, reviewer may tighten)

| Instruction | Target |
|---|---|
| `create_task` | 120k |
| `fund_task` | 60k |
| `submit_result` | 80k |
| `verify_task` | 400k (dominated by ProofVerifier CPI) |
| `release` | 120k |
| `expire` | 80k |
| `raise_dispute` | 20k |

`verify_task` + `release` run as separate txs in M1. A compressed `verify_and_release` (§6.1 territory) waits for SIMD-0334's lower pairing cost.

## Invariants

1. Escrow balance == `payment_amount` while `status ∈ {Funded, ProofSubmitted, Verified, Disputed}`; 0 after `Released | Expired | Resolved`.
2. `protocol_fee + solrep_fee < payment_amount` always (enforced at create via bps cap).
3. Every state transition emits exactly one event.
4. `status == Verified` ⇒ `ProofVerifier::verify_proof` returned `Ok` on the stored `(task_hash, result_hash, deadline, submitted_at, criteria_root)`.
5. `release` cannot execute before `dispute_window_end`.
6. `expire` cannot execute while `status ∈ {Verified, Released, Expired, Disputed, Resolved}`.
7. No instruction can move escrow funds without first setting terminal status on `TaskContract`.
8. `record_job_outcome` is called exactly once per task lifetime — on `release` or `expire` (or later on `resolve` in M2).
9. `agent_did` on task matches the `agent_did` of the signer's `AgentAccount` at `submit_result`.

## Security checks (backend §5.1)

- **Account Validation:** Anchor seeds + bumps on `MarketGlobal`, `TaskContract`, `TaskEscrow`. Owner = program. Discriminator enforced. CPIs to AgentRegistry, TreasuryStandard, ProofVerifier use stored program IDs in `MarketGlobal` — hard equality check, not passed by caller.
- **Re-entrancy:** critical. `release` sets `status = Released` and zeroes derived amounts **before** any Token-2022 transfer or AgentRegistry CPI. `expire` likewise. No CPI target can re-enter TaskMarket with the same task in a pre-transfer state because the status gate rejects.
- **Integer Safety:** fee math via `u128` intermediates, `checked_sub` for payout. Deadline arithmetic checked against i64 bounds (`created_at + max_deadline_secs` checked_add).
- **Authorization:** client-signed paths for create/fund/cancel/dispute; agent-operator signed for submit; permissionless for verify/release/expire (all gated by status + time).
- **Slashing Safety:** N/A here; slashing lives in AgentRegistry.
- **Oracle Safety:** no direct oracle use in M1 — TreasuryStandard's Jupiter path is not invoked from TaskMarket in M1.
- **Upgrade Safety:** Squads 4-of-7, **14-day timelock** per §2.6 (critical-path program).
- **Token Safety:** Token-2022 `transfer_checked` only. Payment-mint whitelist excludes TransferHook/ConfidentialTransfer extensions. Fee destinations pre-set at global init — never caller-supplied.
- **Pause:** blocks `create_task`, `fund_task`, `release`. Leaves `expire` and `raise_dispute` open so funds cannot be trapped indefinitely by a paused program.
- **Jito bundle assumption:** program does NOT rely on atomicity — if only `create_task` lands, `cancel_unfunded_task` after 5-min grace lets the client recover. Documented assumption per §5.1 "Jito bundle assumptions".

## Open questions for reviewer

- Milestone handling: §2.4 mentions `milestone_count`. M1 ships the field but the release path is single-shot. Multi-milestone release is deferred to M2 unless reviewer requires earlier.
- Quality metrics fed to `record_job_outcome`: M1 uses `all-good` on verify success; reviewer may want the agent to include self-reported quality inputs that the circuit also validates.
- `expire` grace of 1h — reasonable default; tune after benchmarking proof-gen latency.
- Whether `verify_task` should also advance `dispute_window_end` reset if `submitted_at > deadline` (currently `verify_task` accepts any time; the circuit itself enforces `submitted_at <= deadline`, so proof will fail otherwise).

## Done-checklist

- [ ] Full state machine implemented; illegal transitions rejected
- [ ] `create_task` + `fund_task` as separate instructions; Jito bundle wrapper demonstrated in integration test
- [ ] Partial bundle (create only) recoverable via `cancel_unfunded_task` after grace
- [ ] `submit_result` rejects non-operator signer, wrong status, past deadline
- [ ] `verify_task` CPIs ProofVerifier with public inputs in the locked order (spec 06); verified against spec 05 test vector
- [ ] `release` refuses to execute before `dispute_window_end`; refuses when paused
- [ ] `expire` refunds client and calls `record_job_outcome` with `success=false`
- [ ] `raise_dispute` freezes status; M2 integration hook documented
- [ ] Fee math tested with edge amounts: 1 unit, max u64 / 10_000, ensures no overflow
- [ ] Re-entrancy audit: every CPI site annotated with the pre-CPI state write
- [ ] Golden-path integration test (end-to-end, localnet): register agent → fund treasury → create+fund task → submit result + proof → verify → release → agent balance increases, fees collected, reputation recorded
- [ ] CU measurements per instruction in `reports/07-task-market-anchor.md`
- [ ] IDL at `target/idl/task_market.json`
- [ ] Security auditor pass (§5.1); findings closed
- [ ] Reviewer gate green; spec ready for OtterSec queue
