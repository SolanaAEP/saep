# Spec — DisputeArbitration Program

**Owner:** anchor-engineer
**Depends on:** 03 (AgentRegistry), 07 (TaskMarket), Switchboard VRF v3, NXSStaking (arbitrator stake).
**Blocks:** M2 TaskMarket unfreeze on `Disputed` status; frontend `/governance` dispute panel.
**References:** backend PDF §2.5 (full spec), §2.1 (CU budget — target `raise_dispute` 40k / `commit_vote` 25k / `reveal_vote` 35k / `tally_round` 120k / `resolve_dispute` 180k), §2.6 (7-day upgrade timelock), §5.1 (Re-entrancy — CPIs into TaskMarket, Authorization, Integer Safety, Oracle/VRF Safety, Slashing Safety).

## Goal

On-chain dispute resolution for TaskMarket. A client who lost trust in a verified result raises a dispute within the 24h dispute window; a staked arbitrator pool selected by Switchboard VRF renders a binding verdict via commit-reveal; on majority decision, DisputeArbitration CPIs back into TaskMarket to execute release-to-agent, refund-to-client, or a programmable split. Appeals promote the case to a 5-arbitrator second round. Bad-faith voters are slashed with a 10% per-incident cap under a 30-day timelock, matching AgentRegistry slash invariants.

Every transition is signed, seeded, and event-logged so the indexer can replay any dispute deterministically and the portal can surface live arbitration status.

## State

### `DisputeConfig` PDA — singleton (extends existing scaffold struct)
- **Seeds:** `[b"dispute_config"]`
- **Fields:**
  - `authority: Pubkey`
  - `task_market: Pubkey`
  - `agent_registry: Pubkey`
  - `nxs_staking: Pubkey` — arbitrator stake lives in NXSStaking
  - `switchboard_program: Pubkey`
  - `stake_mint: Pubkey` — SAEP mint
  - `min_arbitrator_stake: u64` — default `10_000 * 10^decimals` per §2.5
  - `round1_size: u8` — 3
  - `round2_size: u8` — 5
  - `round1_window_secs: i64` — `48 * 3600`
  - `round2_window_secs: i64` — `72 * 3600`
  - `commit_reveal_split_bps: u16` — fraction of the round window allocated to the commit phase (default 5000 = 50%)
  - `appeal_collateral_bps: u16` — extra collateral multiplier for appeal (default 15000 = 1.5× the losing-side stake-sum)
  - `max_slash_bps: u16` — 1000 (10% per §2.5)
  - `slash_timelock_secs: i64` — `30 * 86400` (mirrors AgentRegistry §5.1 Slashing Safety)
  - `vrf_stale_slots: u64` — VRF result rejected if older than this (default 2000 slots ≈ 13 min)
  - `paused: bool`
  - `bump: u8`

### `ArbitratorAccount` PDA
- **Seeds:** `[b"arbitrator", operator.as_ref()]`
- **Fields:**
  - `operator: Pubkey`
  - `stake_pda: Pubkey` — NXSStaking stake account this arbitrator draws weight from
  - `effective_stake: u64` — snapshotted at register + any `refresh_stake` ix
  - `disputes_handled: u64`
  - `minority_votes: u64` — count of rounds where this arbitrator voted with the losing side
  - `bad_faith_strikes: u32` — incremented when a minority vote is slashed
  - `status: ArbitratorStatus` — `Active | Paused | Slashed | Withdrawing`
  - `withdraw_unlock_slot: u64` — 0 if not withdrawing
  - `bump: u8`

### `DisputePool` PDA — per-epoch snapshot of eligible arbitrators
- **Seeds:** `[b"dispute_pool", epoch.to_le_bytes()]`
- **Fields:**
  - `epoch: u64`
  - `arbitrators: Vec<Pubkey>` — max 256 per pool; seeding ix admits new arbitrators once per epoch
  - `total_weight: u128` — sum of `effective_stake`
  - `bump: u8`

  Epoch length = 7 days. Pool rebuilds on `snapshot_pool`, permissionless crank. Selection reads the pool for the current epoch only — ensures VRF randomness commits against a fixed set.

### `DisputeCase` PDA
- **Seeds:** `[b"dispute", task_id.as_ref()]` — 1-to-1 with `TaskMarket::TaskContract.task_id`
- **Fields (backend §2.5 mapping):**
  - `task_id: [u8; 32]`
  - `task_market_account: Pubkey` — PDA of the TaskContract
  - `client: Pubkey`
  - `agent_did: [u8; 32]`
  - `escrow_amount: u64` — snapshot at raise-time
  - `payment_mint: Pubkey`
  - `round: u8` — 1 or 2
  - `status: DisputeStatus`
  - `arbitrators: [Pubkey; 5]` — round-1 uses first 3 slots, round-2 uses all 5
  - `arbitrator_count: u8` — 3 or 5
  - `vrf_request: Pubkey` — Switchboard VRF account
  - `vrf_fulfilled_at_slot: u64`
  - `commit_deadline: i64`
  - `reveal_deadline: i64`
  - `verdict: DisputeVerdict` — `None | AgentWins | ClientWins | Split { agent_bps: u16 }`
  - `votes_for_agent: u8`
  - `votes_for_client: u8`
  - `votes_for_split: u8`
  - `raised_at: i64`
  - `resolved_at: i64`
  - `bump: u8`

### `VoteRecord` PDA
- **Seeds:** `[b"vote", dispute_case.as_ref(), arbitrator.as_ref()]`
- **Fields:**
  - `dispute_case: Pubkey`
  - `arbitrator: Pubkey`
  - `commit_hash: [u8; 32]` — `keccak256(vote_tag || nonce || arbitrator)`
  - `revealed: Option<DisputeVerdict>`
  - `stake_weight: u64` — snapshot at commit
  - `bump: u8`

### `AppealRecord` PDA
- **Seeds:** `[b"appeal", dispute_case.as_ref()]`
- **Fields:**
  - `dispute_case: Pubkey`
  - `appellant: Pubkey` — client or agent operator
  - `collateral_amount: u64` — locked at propose-time, slashed on losing appeal
  - `collateral_escrow: Pubkey` — token account
  - `proposed_at: i64`
  - `bump: u8`

### `PendingSlash` PDA (mirrors AgentRegistry pattern)
- **Seeds:** `[b"pending_slash", arbitrator.as_ref()]`
- **Fields:** `arbitrator`, `amount`, `reason_code: u8`, `proposed_at: i64`, `executable_at: i64`, `bump`. Single outstanding slash per arbitrator at a time.

### Existing scaffold state (keep)
- `ReentrancyGuard` + `AllowedCallers` — already in `guard.rs` at `4ac3da3+`. Used at every inbound CPI from TaskMarket (appeal flow) and outbound CPI into TaskMarket (resolution flow).

## Enums

```
enum ArbitratorStatus { Active, Paused, Slashed, Withdrawing }

enum DisputeStatus {
    RequestedVrf,   // case raised, VRF request in flight
    SelectionReady, // VRF fulfilled, arbitrators assigned
    Committing,     // commit window open
    Revealing,      // reveal window open
    Tallied,        // verdict computed, awaiting resolve
    Appealed,       // round 2 triggered, same flow re-runs with 5 arbitrators
    Resolved,       // CPIed back into TaskMarket
    Cancelled,      // VRF failure → refund client, mark task Released
}

enum DisputeVerdict { None, AgentWins, ClientWins, Split { agent_bps: u16 } }
```

`Resolved` and `Cancelled` are terminal. `Appealed` resets `round = 2`, re-enters `RequestedVrf` with `arbitrator_count = 5`.

## State machine

```
               raise_dispute (TaskMarket CPI)
                         |
                         v
                  RequestedVrf
                         |
                  (Switchboard VRF callback)
                         v
                 SelectionReady
                         |
                  (start_commit)
                         v
                   Committing
                         |
                  (commit_reveal_split window elapses)
                         v
                    Revealing
                         |
                  (tally_round)
                         v
          +---- majority clean? ----+
          | yes                 | no (2-of-3 tie)
          v                     v
       Tallied --appeal?--> Appealed --> RequestedVrf (round 2, 5 arbitrators)
          |                           |
          v                           v
       Resolved  <---- tally_round ----+ (round 2 decides; no further appeal)

                         OR

                    RequestedVrf --vrf stale--> Cancelled (permissionless crank)
```

Invariant: illegal transitions rejected by status gate. Round 2 tally is final.

## Instructions

### `init_config(task_market, agent_registry, nxs_staking, switchboard_program, stake_mint, params)` — one-shot, deployer.

### `register_arbitrator(stake_pda_bump)`
- **Signers:** `operator`
- **Validation:**
  - CPI-read `NXSStaking::StakeAccount` for `operator`, `status == Active`, `amount >= min_arbitrator_stake`, `lock_unlock_slot > now + round2_window_secs / 0.4` (stake lock must outlast the longest dispute window).
  - `ArbitratorAccount` does not already exist.
- **Effect:** initializes `ArbitratorAccount { status = Active, effective_stake = stake }`.
- **Emits:** `ArbitratorRegistered`

### `refresh_stake()`
- **Signers:** `operator`
- **Effect:** re-reads NXSStaking amount, re-snapshots `effective_stake`. Drops status to `Paused` if stake falls below min.

### `snapshot_pool(epoch)` — permissionless crank
- **Validation:** `epoch == current_epoch_from_clock(now)` OR `epoch == current_epoch + 1` (pre-seed). Pool does not already exist.
- **Effect:** initializes `DisputePool` for `epoch`. Ix takes `remaining_accounts: Vec<ArbitratorAccount>` and filters for `status == Active && effective_stake >= min_arbitrator_stake`. Pushes up to 256 pubkeys into `arbitrators`. Sum into `total_weight`.
- **Emits:** `PoolSnapshotted { epoch, count, total_weight }`

### `raise_dispute(task_nonce)` — CPI-invoked from TaskMarket
- **Signers:** `client` (via TaskMarket)
- **Validation:**
  - Caller = TaskMarket (CPI identity check against `config.task_market`).
  - TaskMarket `status == Disputed` (TaskMarket set this pre-CPI per §5.1).
  - `!config.paused`.
  - Current epoch `DisputePool` exists and `arbitrator_count >= round1_size`.
- **Effect:** creates `DisputeCase { round: 1, arbitrator_count: 3, status: RequestedVrf }`. Submits Switchboard VRF request; `vrf_request` address stored. `raised_at = now`.
- **Emits:** `DisputeRaised { task_id, client, agent_did, escrow_amount }`
- **CU target:** 40k

### `consume_vrf(task_id)` — permissionless crank
- **Validation:** `DisputeCase.status == RequestedVrf`. Switchboard VRF callback fulfilled on `vrf_request` within `vrf_stale_slots`. Current epoch pool unchanged since raise.
- **Effect:** deterministic weighted selection — for each of the N seats, derive `offset = vrf_bytes[i*8..(i+1)*8] % total_weight`, walk the pool's cumulative-stake array, assign the arbitrator at that offset. Reject duplicate selection (re-draw with next 8 bytes). Store pubkeys in `arbitrators[0..N]`. Status → `SelectionReady`. Kick off commit window via implicit `start_commit` (single-ix coupling avoids an extra round-trip).
- `commit_deadline = now + round_window_secs * commit_reveal_split_bps / 10000`
- `reveal_deadline = now + round_window_secs`
- **Emits:** `ArbitratorsSelected { case, arbitrators }`
- **CU target:** 120k (VRF decode + cumulative walk for up to 256-entry pool)

### `cancel_stale_vrf(task_id)` — permissionless crank
- **Validation:** `status == RequestedVrf`, `now_slot > request_slot + vrf_stale_slots`.
- **Effect:** `status = Cancelled`. CPI TaskMarket `force_release` (new TaskMarket ix added in M2 alongside this spec) — refunds client and closes the case; task returns to `Released` with `disputed=true` flag for analytics. No arbitrator slashing (this is infrastructure-fault, not misbehavior).
- **Emits:** `DisputeCancelled { task_id, reason: "vrf_stale" }`

### `commit_vote(task_id, commit_hash)`
- **Signers:** one of `DisputeCase.arbitrators[0..arbitrator_count]`
- **Validation:** `status == Committing`, `now <= commit_deadline`, no prior `VoteRecord` for `(case, arbitrator)`.
- **Effect:** creates `VoteRecord { commit_hash, stake_weight = current effective_stake, revealed: None }`.
- **Emits:** `VoteCommitted`
- **CU target:** 25k

### `reveal_vote(task_id, verdict, nonce)`
- **Signers:** arbitrator
- **Validation:** `status == Revealing` OR (`status == Committing` AND `now > commit_deadline`). `keccak256(verdict_tag || nonce || arbitrator) == vote_record.commit_hash`.
- **Effect:** sets `vote_record.revealed = Some(verdict)`. Increments the per-verdict counter on `DisputeCase`.
- **Emits:** `VoteRevealed`
- **CU target:** 35k

### `tally_round(task_id)`
- **Signers:** any (permissionless)
- **Validation:** `status == Revealing`, `now > reveal_deadline`.
- **Effect:**
  - Count stake-weighted votes per verdict across revealed `VoteRecord`s.
  - Majority rule: any verdict with `> total_revealed_weight / 2` wins.
  - Unrevealed votes auto-slashed (pre-commits bad-faith strike → `PendingSlash` with 30-day timelock). The arbitrator's weight is dropped from the denominator — no quorum gaming.
  - If no clean majority (tie or split-three-ways) **and** `round == 1`: `status = Appealed`. Reset for round 2. Emit `AppealAutoTriggered`.
  - If clean majority OR `round == 2`: `status = Tallied`, `verdict = winner`.
- **Emits:** `RoundTallied { case, round, verdict, votes_for_agent, votes_for_client, votes_for_split }`
- **CU target:** 120k

### `escalate_appeal(task_id)`
- **Signers:** losing party (client if `verdict == AgentWins`, agent operator if `ClientWins`).
- **Validation:** `status == Tallied`, `round == 1`, `now < resolved_at + 86400` (1-day appeal window). Appellant has not already appealed.
- **Effect:** locks `appeal_collateral_bps * escrow / 10000` into `AppealRecord.collateral_escrow`. Status → `Appealed`. Next crank calls `raise_dispute`-equivalent path internally to re-request VRF for 5 arbitrators.
- **Emits:** `AppealEscalated { appellant, collateral }`

### `resolve_dispute(task_id)`
- **Signers:** any (permissionless)
- **Validation:** `status == Tallied`, `verdict != None`. For round 2 terminals, or round 1 when appeal window has elapsed without escalate.
- **Effect (state-before-CPI per §5.1):** set `status = Resolved`, `resolved_at = now`. Then CPI into TaskMarket `execute_dispute_verdict(task_id, verdict)` — TaskMarket performs the actual token movements (release / refund / split). Release appeal collateral back to appellant if `round == 2 && appellant_won`; otherwise collateral is slashed into `fee_collector`.
- Outbound CPI guarded by `check_callee_preconditions` — reentrancy flag flipped before CPI, unset on return.
- **Emits:** `DisputeResolved { task_id, verdict }`
- **CU target:** 180k

### `slash_arbitrator(task_id, arbitrator, reason_code)`
- **Signers:** any (permissionless — reason is derived from `VoteRecord` + verdict)
- **Validation:**
  - `DisputeCase.status ∈ {Resolved}`.
  - `VoteRecord.revealed.is_none()` (unrevealed) OR `VoteRecord.revealed != verdict` (minority) AND arbitrator has `minority_votes_in_last_N >= 3` (bad-faith pattern per §2.5).
  - No existing `PendingSlash` for this arbitrator.
  - `amount = min(effective_stake * max_slash_bps / 10000, effective_stake)`.
- **Effect:** creates `PendingSlash { executable_at = now + slash_timelock_secs }`. Arbitrator `status = Paused`. Increments `bad_faith_strikes`.
- **Emits:** `SlashProposed`

### `execute_slash(arbitrator)`
- **Signers:** any (permissionless crank)
- **Validation:** `now >= PendingSlash.executable_at`.
- **Effect:** CPI into NXSStaking to transfer the slashed amount to `fee_collector`. Close `PendingSlash`. Reset arbitrator to `Active` if `bad_faith_strikes < 5`, else permanently `Slashed`.
- **Emits:** `SlashExecuted`

### `cancel_slash(arbitrator)`
- **Signers:** `authority`
- **Validation:** `PendingSlash` exists, timelock not yet elapsed.
- **Effect:** closes `PendingSlash`. Arbitrator `status = Active`.
- **Emits:** `SlashCancelled`

### `begin_withdraw() / complete_withdraw()`
- Two-step arbitrator exit. `begin_withdraw` sets `status = Withdrawing`, `withdraw_unlock_slot = now + round2_window_secs`. Arbitrator is excluded from future pool snapshots immediately but stays bound for any already-selected case. `complete_withdraw` closes `ArbitratorAccount` after the unlock slot; stake becomes unlockable via NXSStaking.

### `set_params`, `set_paused`, authority two-step — standard governance surface.

## Events

`ArbitratorRegistered`, `PoolSnapshotted`, `DisputeRaised`, `ArbitratorsSelected`, `DisputeCancelled`, `VoteCommitted`, `VoteRevealed`, `RoundTallied`, `AppealEscalated`, `DisputeResolved`, `SlashProposed`, `SlashExecuted`, `SlashCancelled`, `ParamsUpdated`, `PausedSet`.

Each event carries `task_id` (when case-scoped) or `arbitrator` (when operator-scoped) plus `timestamp`, so the indexer can replay any dispute deterministically.

## Errors

`Unauthorized`, `Paused`, `PoolMissing`, `PoolTooSmall`, `VrfStale`, `VrfNotFulfilled`, `WrongStatus`, `CommitWindowClosed`, `RevealWindowClosed`, `CommitHashMismatch`, `DuplicateVote`, `ArbitratorNotSelected`, `AppealWindowClosed`, `AppealCollateralInsufficient`, `TooManyAppeals`, `SlashAlreadyPending`, `SlashTimelockNotElapsed`, `NoMajority`, `VerdictEncodingInvalid`, `StakeInsufficient`, `StakeLockTooShort`, `ArithmeticOverflow`, `CallerNotTaskMarket`, `ReentrancyDetected`, `UnauthorizedCaller`, `CpiDepthExceeded`. (Reentrancy / caller / CPI depth errors reuse existing scaffold enum.)

## CU budget (§2.1 targets; reviewer may tighten)

| Instruction | Target |
|---|---|
| `register_arbitrator` | 60k |
| `snapshot_pool` | variable — 10k + 2k × pool_size, 200k hard cap |
| `raise_dispute` | 40k |
| `consume_vrf` | 120k |
| `cancel_stale_vrf` | 60k |
| `commit_vote` | 25k |
| `reveal_vote` | 35k |
| `tally_round` | 120k |
| `escalate_appeal` | 60k |
| `resolve_dispute` | 180k (CPI dominated) |
| `slash_arbitrator` | 50k |
| `execute_slash` | 80k |

`resolve_dispute` sits adjacent to TaskMarket `release` / `expire` in CU cost — same CPI-to-TaskMarket shape, state-before-CPI contract, token-movement path on the TaskMarket side.

## Invariants

1. At most one `DisputeCase` per `task_id` over the task's lifetime (seed-enforced).
2. `arbitrator_count ∈ {round1_size, round2_size}` only.
3. `arbitrators[0..arbitrator_count]` are pairwise distinct (enforced at `consume_vrf`).
4. Each selected arbitrator has exactly one `VoteRecord` for a given `(case, arbitrator)`.
5. `tally_round` runs at most once per `(case, round)`. Second call on same round rejected by status gate.
6. `round == 1 && verdict == None` is only legal while `status ∈ {RequestedVrf, SelectionReady, Committing, Revealing}`.
7. `round == 2` is terminal — no further appeal, irrespective of outcome.
8. Slash cap: `sum(pending + executed slashes in one dispute) <= effective_stake * max_slash_bps / 10000`. Single-outstanding `PendingSlash` per arbitrator enforces this operationally.
9. `SlashExecuted` cannot fire before `slash_timelock_secs` elapse.
10. `status == Resolved` ⇒ `TaskMarket` received exactly one `execute_dispute_verdict` CPI for `task_id`.
11. Appeal collateral is either returned (appellant won round 2) or sent to `fee_collector` (appellant lost) — never trapped.
12. `effective_stake` at vote weight = stake at `commit_vote`, not at `tally_round`. Prevents mid-case stake inflation.
13. VRF result reused within a case only (round 1 and round 2 re-request independently).

## Security checks (backend §5.1)

- **Account Validation:** Anchor seeds + bumps on `DisputeConfig`, `ArbitratorAccount`, `DisputePool`, `DisputeCase`, `VoteRecord`, `AppealRecord`, `PendingSlash`. Discriminator enforced. CPI identities for NXSStaking / AgentRegistry / TaskMarket / Switchboard read from `DisputeConfig` — hard equality, never caller-supplied.
- **Re-entrancy:** inbound CPI (`raise_dispute` from TaskMarket) goes through `check_callee_preconditions` — caller guard must be active, `DisputeArbitration`'s guard must be inactive pre-entry. Outbound CPI (`resolve_dispute` → TaskMarket) sets `status = Resolved` before the CPI, so even a malicious TaskMarket upgrade cannot re-enter and double-settle.
- **Integer Safety:** stake-weighted tally via `u128`; cumulative-weight walk rejects modular overflow; `checked_*` on slash amounts and timelock deadlines.
- **Authorization:** arbitrator-signed for commit/reveal; permissionless for tally / resolve / consume_vrf / cancel_stale_vrf / slash proposals (all status-gated); client-signed through TaskMarket CPI for raise; losing-party signed for escalate.
- **Slashing Safety:** 30-day timelock + 10% cap + single-outstanding PendingSlash per arbitrator. Mirrors AgentRegistry §5.1 contract. `cancel_slash` available to authority until timelock elapses.
- **Oracle / VRF Safety:** Switchboard program ID hard-pinned at init. VRF staleness check (`vrf_stale_slots`) prevents replay against an old randomness seed if someone delays `consume_vrf` across a pool change. VRF failure → `cancel_stale_vrf` refunds the client rather than trapping funds — matches §5.1 "oracle failure does not trap value".
- **Upgrade Safety:** Squads 4-of-7, 7-day timelock per §2.6 (not critical-path, so same window as AgentRegistry/TreasuryStandard).
- **Token Safety:** Slashed tokens move via NXSStaking's existing transfer path (Token-2022 `transfer_checked`); appeal collateral uses Token-2022 `transfer_checked` with the case's `payment_mint`. No raw `transfer` anywhere.
- **Pause:** blocks `raise_dispute`, `commit_vote`, `reveal_vote`, `escalate_appeal`. Leaves `tally_round`, `resolve_dispute`, `execute_slash`, `cancel_stale_vrf` unblocked so an in-flight case cannot be trapped by a pause.
- **Jito bundle assumption:** none. Dispute flow is multi-step across hours; no bundle atomicity required.
- **DOS surface:** `snapshot_pool` caps at 256 arbitrators — once the pool grows past that, the reviewer-tightened version splits pool into sharded PDAs. Out of M2 scope; add when arbitrator count exceeds ~200.

## CPI contract with TaskMarket

DisputeArbitration depends on two TaskMarket instructions not in spec 07's M1 surface:

1. `execute_dispute_verdict(task_id, verdict: DisputeVerdict)` — called by DisputeArbitration on `resolve_dispute`. TaskMarket validates caller = DisputeArbitration, validates case is `Disputed`, and transitions to `Resolved` with token movements per verdict (release-to-agent / refund-to-client / split).
2. `force_release(task_id, reason_code)` — called by DisputeArbitration on `cancel_stale_vrf`. TaskMarket treats as an expedited release with `disputed=true` flag on `record_job_outcome`.

Both added to TaskMarket in the M2 cycle that lands DisputeArbitration. Spec 07 reserves the `Disputed → Resolved` transition; this spec fills in the caller.

## Open questions for reviewer

- **Pool snapshot cadence.** 7-day epoch matches backend §2.5 cadence but drifts against arbitrator churn. Reviewer may want a hot-path refresh on `raise_dispute` (O(log N) index update) versus the whole-pool rebuild.
- **Minority-pattern threshold.** §2.5 says "repeated pattern"; spec picks `>= 3 minority votes in the last N rounds`. Reviewer sets N (default proposal: 10).
- **Appeal collateral default 1.5×.** §2.5 says "additional collateral"; the multiplier is a judgment call. 1.5× of loser-side stake-sum rounds up to a non-trivial cost without pricing out honest appellants.
- **VRF replacement path.** If Switchboard VRF is unavailable at M2 launch, fallback to recent-blockhash + slot-hash-based lottery is unacceptable (manipulable by leader). Reviewer may require a second VRF provider (Chainlink VRF on Solana is in preview as of 2026-04). Deferred to a separate decision doc if Switchboard signal weakens.
- **Stake lock coupling to NXSStaking.** Registration requires stake lock `> round2_window_secs / 0.4` — assumes slot ~= 400ms, coarse. Reviewer may tighten to a per-slot-rate config read from a slot-rate oracle.

## Done-checklist

- [ ] Full state machine implemented; illegal transitions rejected
- [ ] `register_arbitrator` reads NXSStaking via CPI; rejects under-staked / short-locked operators
- [ ] `snapshot_pool` filters inactive arbitrators; caps at 256
- [ ] `raise_dispute` only callable from TaskMarket via CPI identity check
- [ ] `consume_vrf` weighted-draw matches the cumulative-stake walk; duplicates rejected
- [ ] `cancel_stale_vrf` refund path exercised in integration test
- [ ] `commit_vote` / `reveal_vote` commit-reveal scheme: reveal fails on mismatched hash; fails after `reveal_deadline`
- [ ] `tally_round` round-1 no-majority triggers `Appealed`; round-2 no-majority locks `verdict = None` with reviewer-specified fallback
- [ ] `escalate_appeal` locks collateral via `transfer_checked`; refund path green on round-2 win
- [ ] `resolve_dispute` CPIs `TaskMarket::execute_dispute_verdict` once; state-before-CPI verified by re-entrancy audit
- [ ] `slash_arbitrator` respects `max_slash_bps` cap and `slash_timelock_secs` window; `cancel_slash` works during timelock
- [ ] `execute_slash` CPIs NXSStaking; slashed tokens routed to `fee_collector`
- [ ] Every CPI site annotated with the pre-CPI state write
- [ ] Golden-path integration test (localnet): register 5 arbitrators → fund a task → raise dispute → VRF fulfill → commit/reveal/tally → majority agent wins → resolve → agent balance increases, dispute recorded on TaskMarket
- [ ] Appeal path integration test: round 1 no-majority → round 2 selects 5 → round 2 terminal
- [ ] Slash path integration test: minority voter hit with 3-strike threshold → slash proposed → wait 30 days (bankrun warp) → slash executed
- [ ] Reentrancy test: malicious TaskMarket upgrade attempts re-entry on `resolve_dispute` — rejected
- [ ] CU measurements per instruction in `reports/dispute-arbitration-anchor.md`
- [ ] IDL at `target/idl/dispute_arbitration.json`
- [ ] Security auditor pass (§5.1); findings closed
- [ ] Reviewer gate green; spec ready for Neodyme M2 queue
