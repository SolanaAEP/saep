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

## Events

`TaskCreated`, `TaskFunded`, `ResultSubmitted`, `TaskVerified`, `VerificationFailed`, `TaskReleased`, `TaskExpired`, `DisputeRaised`, `GlobalParamsUpdated`, `PausedSet`.

All events carry `task_id` and `timestamp` so the indexer can reconstruct per-task history deterministically.

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
