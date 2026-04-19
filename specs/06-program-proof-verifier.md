# Spec 06 — ProofVerifier Program

**Owner:** anchor-engineer + zk-circuit-engineer
**Depends on:** 05
**Blocks:** 07 (TaskMarket verifies proofs at settlement)
**References:** backend PDF §2.1 (ProofVerifier listed in upgrade table §2.6, 7-day timelock for verifier-key rotation), §2.4 (Groth16 via Light Protocol, ~400K CUs pre-SIMD-0334 / ~200K post), §5.1 (Account Validation, Upgrade Safety), §5.2 (trusted setup), §6.1 (batch verification — M2+ optimization, hook only in M1)

## Goal

On-chain Groth16 verifier on bn254. Loads a verifying key from a governance-controlled PDA, accepts `(proof, public_inputs)`, runs the pairing check via Light Protocol's bn254 primitives, and returns a verdict that TaskMarket (spec 07) treats as authoritative.

M1 ships: single-proof verify, VK governance rotation with 7-day timelock, public-input ordering locked to spec 05, CU-budgeted to fit in one tx, batch verify stubbed (handler + interface only).

## State

### `VerifierConfig` PDA — singleton
- **Seeds:** `[b"verifier_config"]`
- **Fields:**
  - `authority: Pubkey` — governance
  - `active_vk: Pubkey` — pointer to currently active `VerifierKey` PDA
  - `pending_vk: Option<Pubkey>` — rotation staging slot
  - `pending_activates_at: i64` — now + 7 days at propose time
  - `paused: bool`
  - `bump: u8`

### `VerifierKey` PDA — per-VK (multiple may exist; at most one `active`)
- **Seeds:** `[b"vk", vk_id.as_ref()]` where `vk_id: [u8; 32]` — governance-chosen label, typically a hash of the VK bytes
- **Fields:**
  - `vk_id: [u8; 32]`
  - `alpha_g1: [u8; 64]`
  - `beta_g2: [u8; 128]`
  - `gamma_g2: [u8; 128]`
  - `delta_g2: [u8; 128]`
  - `ic: Vec<[u8; 64]>` — `ic.len() == num_public_inputs + 1`; for spec 05 = 6
  - `num_public_inputs: u8` — pinned to 5 at initial setup; rotations may change it but public-input order MUST stay documented
  - `circuit_label: [u8; 32]` — e.g. "task_completion_v1"
  - `is_production: bool` — false for test-SRS VKs; TaskMarket rejects non-production in mainnet mode (see `GlobalMode` flag below)
  - `registered_at: i64`
  - `registered_by: Pubkey`
  - `bump: u8`

On-chain size: fixed-width for `num_public_inputs <= 16` (M1 cap; reviewer may raise). Expected ~1.4 KB per VerifierKey account.

### `GlobalMode` PDA (reused from a future GovernanceProgram; M1 stubs a local copy)
- **Seeds:** `[b"mode"]`
- **Fields:** `is_mainnet: bool`, `bump: u8`. Devnet builds set `is_mainnet = false` so test-SRS VKs are accepted.

## Instructions

### `init_config(authority)`
- One-shot, deployer-signed.

### `register_vk(vk_id, alpha_g1, beta_g2, gamma_g2, delta_g2, ic, num_public_inputs, circuit_label, is_production)`
- **Signers:** `authority`
- **Validation:**
  - `VerifierKey` for `vk_id` does not exist
  - `num_public_inputs == ic.len() - 1`
  - `num_public_inputs <= 16`
  - Points lie on correct curves — delegate to Light Protocol's `bn254` deserializers (error on invalid encoding)
  - `!config.paused`
- Creates `VerifierKey`. Does NOT activate it.
- **Emits:** `VkRegistered { vk_id, circuit_label, is_production }`

### `propose_vk_activation(vk_id)`
- **Signers:** `authority`
- **Validation:** VK exists, no pending rotation already in flight
- Sets `config.pending_vk = Some(vk_id)`, `pending_activates_at = now + 7 days` (§2.6).
- **Emits:** `VkActivationProposed { vk_id, activates_at }`

### `execute_vk_activation()`
- **Signers:** any (permissionless crank) after timelock
- **Validation:** `pending_vk.is_some()`, `now >= pending_activates_at`
- Swaps `active_vk = pending_vk`, clears pending.
- **Emits:** `VkActivated { vk_id }`

### `cancel_vk_activation()`
- **Signers:** `authority`. Clears pending without activating.

### `verify_proof(proof_a: [u8; 64], proof_b: [u8; 128], proof_c: [u8; 64], public_inputs: Vec<[u8; 32]>) -> Result<()>`
- **Signers:** any caller (typically TaskMarket via CPI; also usable by relayers)
- **Validation:**
  - `!config.paused`
  - `active_vk` account passed in matches `config.active_vk`
  - `public_inputs.len() == vk.num_public_inputs`
  - Each public input is a valid bn254 scalar (< field modulus)
  - If `mode.is_mainnet`, require `vk.is_production == true`
- **Computation:**
  - Pairing check `e(A, B) == e(alpha, beta) * e(VK_x, gamma) * e(C, delta)` where `VK_x = IC[0] + Σ IC[i+1] * public_input[i]`
  - Delegated to Light Protocol `groth16_verifier::verify` (or equivalent bn254 primitive — pinned library version captured in `Cargo.toml`)
- **Result:** `Ok(())` on valid; `Err(ProofInvalid)` otherwise.
- Does not mutate state (pure verifier). TaskMarket records the outcome in its own state.

### `batch_verify_stub(proofs: Vec<BatchEntry>, public_inputs: Vec<Vec<[u8; 32]>>)`
- **M1:** returns `NotImplemented`. Handler reserved + IDL entry committed so SDK type is stable (§6.1 roadmap).

### `set_paused`, `transfer_authority`, `accept_authority`
- Standard governance hooks as in specs 02/03.

### Scaffold-vs-spec deltas (reconciled against `programs/proof_verifier/src/lib.rs` `#[program]` block, 22 `pub fn` entries)

Pre-edit §Instructions enumerates 8 explicit handlers plus the 3-call governance umbrella (11 ix). Scaffold ground truth = 22 `pub fn`, covering 4 families absent from the pre-edit text plus a stub-replacement and two arg-shape drifts. All 11 absent blocks land post-scaffold via the commit anchors cited below. Closes the M1 §Instructions sweep arc (5-of-5 in-scope programs reconciled — capability_registry cycle 172, treasury_standard cycle 163, dispute_arbitration cycle 166, task_market cycle 167, agent_registry cycle 173, proof_verifier this cycle).

- **Stub-replacement (1 ix → 4 ix state machine, landed `61e4d80` + stack-overrun fix `b16794e`):** spec line 93 `batch_verify_stub` was reserved as a single `NotImplemented` handler at M1; scaffold replaces it with a 4-ix random-linear-combination state machine that reduces 4N pairings to N+3 per the §6.1 batch-verify roadmap.
  - `open_batch(batch_id: [u8; 16], max_proofs: u8)` — `batch_verify.rs:44`. Permissionless cranker-signed init of `BatchState` PDA (seeds `[b"batch", cranker, batch_id]`, capped at `MAX_BATCH_SIZE`). Sets `batch.vk_key = config.active_vk` (snapshot at open-time) + Fiat-Shamir seed from `(batch_id, cranker, slot)`. Emits no event.
  - `add_batch_proof(proof_a, proof_b, proof_c, public_inputs)` — `batch_verify.rs:99`. Cranker-signed (`has_one = cranker`). Per-proof: validates `vk_key == config.active_vk` snapshot, derives next RLC scalar via keccak Fiat-Shamir chain (128-bit truncation), accumulates `(α·A, α·VK_x, α·C)` into `batch.acc_*` G1 points. Idempotent under `count < max_proofs`. Emits no event.
  - `finalize_batch()` — `batch_verify.rs:194`. Permissionless. Asserts `batch.count >= 1`. Single 4-pair pairing check over the accumulated points + `(α_sum·alpha, beta)` + `(VK_x_sum, gamma)` + `(C_sum, delta)`. On success closes the PDA (rent-refund to cranker) + emits `BatchVerified { batch_id, count, vk_id }`. On failure leaves the PDA open for `abort_batch`. **Note:** §State block (lines 14–47) does not declare the `BatchState` PDA — surfaced inline below.
  - `abort_batch()` — `batch_verify.rs:256`. Cranker-signed escape hatch; closes the PDA without emitting. Used after a single bad `add_batch_proof` would have caused `finalize_batch` to fail.
- **Chunked VK registration (2 ix, landed `b5916a6`, supersedes legacy single-tx `register_vk` for IC > ~6 G1 points):** F-2026-02 circuit rebinding (per `7c2143c`) extended the `task_completion` circuit from 5 → 9 public inputs, growing `IC` from 6 → 10 G1 points. Resulting single-tx `register_vk` payload (~1166 bytes) exceeded both the Anchor 0.31 client `Buffer.alloc(1000)` scratch buffer and the Solana ~1232-byte transaction-size ceiling. Resolution = chunked PDA-mutation pair; legacy `register_vk` retained for backward compat on small VKs.
  - `init_vk(vk_id, alpha_g1, beta_g2, gamma_g2, delta_g2, num_public_inputs, circuit_label, is_production)` — `init_vk.rs:33`. Authority-signed. Allocates `VerifierKey` PDA (seeds `[b"vk", vk_id]`) with `ic = Vec::new()` + `registered_at = 0` (sentinel for "init phase, not yet finalized"; `registered_by = authority` pins the chunk-uploader). Validates `num_public_inputs <= MAX_PUBLIC_INPUTS` + `!paused`. Emits no event (the `VkRegistered` emit is deferred to the finalize chunk per §Events line 104 dual-emit callout).
  - `append_vk_ic(ic_points: Vec<[u8; 64]>, finalize: bool)` — `append_vk_ic.rs:28`. Authority-signed (`registered_by == authority` constraint pins the same uploader as `init_vk`). Pushes IC points into `vk.ic` under bounds `vk.ic.len() < num_public_inputs + 1`; rejects if PDA is already finalized (`registered_at != 0` constraint via `VkAlreadyFinalized`). When `finalize == true`: asserts exact `vk.ic.len() == num_public_inputs + 1`, sets `registered_at = now`, emits `VkRegistered { vk_id, circuit_label, is_production }` — the second of the two `VkRegistered` call sites per §Events line 104.
- **Reputation rail (1 ix, F-2026-02 fail-close interim then re-enabled, landed `733cc7a` initial + `7c2143c` rebinding):**
  - `verify_and_update_reputation(proof_a, proof_b, proof_c, public_inputs, agent_did, capability_bit, sample, task_id)` — `reputation_cpi.rs:119`. Caller signs (typically task_market via CPI; reentrancy-guarded by the cross-program guard DAG — `caller_guard` + `self_guard` + `allowed_callers` PDAs validated via `load_caller_guard` per F-2026-04 fix). After Groth16 verification succeeds, extracts `(agent_did, capability_bit, sample_hash, task_id)` from `public_inputs[5..=8]` (the 4-field rebinding per F-2026-02 full-fix outline), recomputes `sample_hash` on-chain via `hash_sample(sample)` and asserts equality (defense-in-depth against sample tampering), then CPIs `agent_registry::update_reputation` signed by the `[b"rep_authority"]` PDA. `proof_key = keccak(proof_a)` for replay tracking on the callee. **Status note:** `ProofVerifierError::ReputationBindingNotReady` (errors.rs:62) was the F-2026-02 interim fail-close return; the variant remains declared but is no longer the active return path post-`7c2143c`. Audit-fix-manifest line 18 still tracks the entry as `DEFERRED (fail-close in place)` — surfaced inline as a manifest-vs-scaffold drift not patched here. Spec §Events line 107 carries the matching pre-edit fail-closed claim and is similarly stale post-`7c2143c`.
- **Guard-admin family (4 ix, #7 scaffolding landed `c759a7b` + `2f76d3f`, helper-extract `cd5b594`):** matches the agent_registry / treasury_standard / dispute_arbitration / task_market guard-admin rollout cohort.
  - `init_guard(initial_callers: Vec<Pubkey>)` — `guard.rs:42`. Authority-gated one-shot. Initializes `ReentrancyGuard` PDA (seeds `[SEED_GUARD]`) + `AllowedCallers` PDA (seeds `[SEED_ALLOWED_CALLERS]`).
  - `set_allowed_callers(programs: Vec<Pubkey>)` — `guard.rs:75`. Authority-gated list rewrite.
  - `propose_guard_reset()` — `guard.rs:105`. Authority-gated; starts admin-reset timelock.
  - `admin_reset_guard()` — `guard.rs:125`. Authority-gated post-timelock crank.
  - **Guard-admin-vocabulary matrix row (post-cycle):** proof_verifier = `live-runtime-ix + struct-only-events`. Per §Events line 110 the program inverts the cohort convention — `ReentrancyRejected` is live ×4 (only program in the cohort with live runtime-rejection emits) while `GuardEntered` is struct-only and `GuardInitialized` / `GuardAdminReset` / `AllowedCallersUpdated` admin events are absent entirely. Runtime-ix surface (init_guard / set_allowed_callers / propose_guard_reset / admin_reset_guard) is live as authority-gated handlers but admin-event emits are not wired. 5-program guard-vocabulary matrix complete: capability_registry `N/A`; treasury_standard / dispute_arbitration / task_market `live-events, runtime-ix varies`; agent_registry `live-events + live-runtime-ix`; proof_verifier `live-runtime-ix + struct-only-events` (sole inverter).
- **Arg-shape drift on `init_config` (pre-edit signature understates by 1 arg):** spec line 50 `init_config(authority)` (1 arg); scaffold `lib.rs:21` is 2 args: `(authority, is_mainnet)`. The `is_mainnet: bool` populates the `GlobalMode` PDA at init-time rather than via a separate setter post-init. `init_config.rs:7-30` accounts struct co-inits both `VerifierConfig` and `GlobalMode` PDAs in the same handler — a single-tx bootstrap rather than the spec's implied two-step (`init_config` for `VerifierConfig` + a separate `init_mode` for `GlobalMode`). Not a behavior change; consolidation matches the agent_registry cycle-173 `init_global` consolidation pattern (init-time pubkey/flag population vs spec's implied per-setter rollout).
- **Arg-shape drift on `propose_vk_activation` (pre-edit signature carries `vk_id`, scaffold takes ctx-only):** spec line 64 `propose_vk_activation(vk_id)`; scaffold `lib.rs:56` is `(ctx)` only. The `vk_id` is derived from the `pending_vk: Account<VerifierKey>` passed in `ProposeVkActivation` accounts struct (`vk_activation.rs:29`); Anchor's PDA seed validation (`seeds = [b"vk", vk.vk_id]`) enforces the binding without the redundant ix-arg. Same idiom as the cycle-167 task_market `assigned_agent` derivation drift.
- **Authority two-step naming drift:** spec line 96 umbrella `set_paused, transfer_authority, accept_authority` — scaffold matches but exports the two-step under `instructions::authority::{transfer_authority_handler, accept_authority_handler}` (`authority.rs:20` + `:42`). No arg-shape or behavior drift.

**State-side drift surfaced (not patched here):** `VerifierConfig` in `state.rs` carries `pending_authority: Option<Pubkey>` (the two-step authority transfer slot, populated by `transfer_authority` and consumed by `accept_authority`) absent from §State `VerifierConfig` block (lines 16–24). `VerifierKey.registered_at` doubles as a `0`-sentinel finalize-flag for the chunked-flow `init_vk + append_vk_ic` lifecycle — semantic load not documented in §State `VerifierKey` line 38 (which describes it as a wall-clock stamp only). `BatchState` PDA (seeds `[b"batch", cranker, batch_id]`, fields `cranker` + `vk_key` + `batch_id` + `count` + `max_proofs` + `acc_alpha` + `acc_vk_x` + `acc_c` + `random_state` + `bump`) is a new account type absent from §State entirely. `AllowedCallers` + `ReentrancyGuard` PDAs (seeds `[SEED_ALLOWED_CALLERS]` + `[SEED_GUARD]`) are also absent — same omission as the 4 sister M1 in-scope programs' §State blocks. `MAX_BATCH_SIZE` + `REP_PUBLIC_INPUT_COUNT` + `REP_AUTHORITY_SEED` + `MAX_PUBLIC_INPUTS` are new constants. Held for future §State-sweep cycle.

**Errors drift surfaced (not patched here):** §Errors block (lines 116–131) lists 14 variants; scaffold `errors.rs` enumerates more (chunked-flow + reputation + guard + batch families: `VkAlreadyFinalized`, `IcLengthMismatch`, `TooManyPublicInputs`, `InvalidBatchSize`, `BatchFull`, `BatchEmpty`, `VkSnapshotMismatch`, `ReputationBindingNotReady` (interim, see reputation rail above), `PoseidonError`, `SampleHashMismatch`, `CpiDepthExceeded`, `PairingCheckFailed`, etc.). Bundled with the (ad-2) cross-spec §Errors sweep candidate.

**§Done-checklist drift surfaced (not patched here):** §Done-checklist line 199 `batch_verify_stub present in IDL, returns NotImplemented` is stale post-`61e4d80` — scaffold ships the 4-ix state machine, not the stub. Audit-package-m1.md §3.4 instruction-list wording (`batch_verify_stub [OUT OF SCOPE — returns NotImplemented]`) carries the matching stale claim and is held for the §3.4-deferral discipline of cycles 127/129. Cross-spec sweep candidate; not patched here per single-section scope.

**Audit-package-m1 §3.4 register_vk target-line discipline:** audit-package §3.4 enumerates 10 instructions (init_config, init_vk, append_vk_ic, register_vk, propose_vk_activation, execute_vk_activation, cancel_vk_activation, verify_proof, batch_verify_stub, set_paused, authority two-step) — covers the chunked + legacy VK paths but does not enumerate `verify_and_update_reputation` (per F-2026-02 DEFERRED status, intentional omission from the audit-frozen surface) or the 4 guard-admin handlers (per the §3.4-deferral cycle-127/129 discipline holding the audit-package surface stable across post-freeze additions). No §3.4 edit landed this cycle; cross-cite preserved here for reviewer cross-reading the audit package vs the spec.

**Post-edit §Instructions arc state:** **6-of-6 §Instructions reconciliations land** (cycle 163 task_market / cycle 166 dispute_arbitration / cycle 167 treasury_standard / cycle 172 capability_registry / cycle 173 agent_registry / this cycle proof_verifier). M1 §Instructions sweep arc closed across all 5 M1-in-scope programs + `task_market` (which spans M1 + M2 caller surfaces). Remaining §Instructions sweep candidates carry forward to M2-only specs: (ag) `specs/program-governance.md`, (ab) `specs/program-fee-collector.md`, (ac) `specs/program-nxs-staking.md`. State-sweep arc + Events-refresh arc + Errors-cross-spec arc remain queued per cycle 173 next-options block.

## Events

Emit surface = 11 struct declarations in `events.rs`, 14 `emit!` call sites across 7 ix files (source: `grep emit! programs/proof_verifier/src/`). 10 events live, 1 struct-only.

- **Global init** — `VerifierInitialized { authority }` at `init_config.rs:46`.
- **VK lifecycle** — `VkRegistered { vk_id, circuit_label, is_production }` emits twice: `register_vk.rs:71` (legacy single-tx path) and `append_vk_ic.rs:49` (chunked-flow finalize per cycle-117 `init_vk + append_vk_ic × N` supersession after F-2026-02 circuit extension drove the single-tx payload over the Anchor 0.31 client 1000-byte scratch-buffer ceiling; resolved public `b5916a6`). `VkActivationProposed { vk_id, activates_at }` at `vk_activation.rs:45` (7-day timelock target per spec §1). `VkActivated { vk_id }` at `vk_activation.rs:89`. `VkActivationCancelled { vk_id }` at `vk_activation.rs:116`.
- **Verify-proof** — no success event on the happy path (hot path; TaskMarket's `TaskVerified` / `VerificationFailed` per cycle-164 §Events sweep close the settlement-side trace). Reject path emits `ReentrancyRejected { program, offending_caller, slot }` ×2 at `verify_proof.rs:75` + `:92` on guard-check failure (caller mismatch / stack-height overflow). Proof_verifier is the **only** program across the 9-cycle §Events sweep where `ReentrancyRejected` is live — every sister program declares it as scaffold-parity placeholder only.
- **Batch verify** — `BatchVerified { batch_id, count, vk_id }` at `batch_verify.rs:232` inside `finalize_batch_handler`. `open_batch`, `add_batch_proof`, `abort_batch` emit nothing — the batch state-machine is observable on-chain via `BatchState` PDA reads + the terminal `BatchVerified` only.
- **Reputation CPI (F-2026-02 inert rail)** — `ReentrancyRejected` ×2 at `reputation_cpi.rs:146` + `:163` on guard-check failure. The `verify_and_update_reputation_handler` itself is fail-closed per F-2026-02 (cycle-73 `reports/proof-verifier-audit.md` §Findings) and returns before state change, but the guard-check reject path still fires. Indexer-side: a `ReentrancyRejected` keyed on `reputation_cpi.rs` means a caller tried the inert rail *and* violated the guard — fail-closed on both axes, no state change.
- **Pause** — `PausedSet { paused }` at `set_paused.rs:23`.
- **Authority two-step** — `AuthorityTransferProposed { pending }` at `authority.rs:26`. `AuthorityTransferAccepted { new_authority }` at `authority.rs:55`.
- **Guard runtime (struct-only)** — `GuardEntered { program, caller, slot, stack_height }` declared at `events.rs:53` but no emit site in the crate. **Inverse of the cohort convention**: all 8 prior-swept programs declare `ReentrancyRejected` struct-only + `GuardEntered` live (with `GuardEntered` counts of 7 in task_market, 1 in treasury, 0 in fee_collector / nxs_staking / dispute / governance / capability). Proof_verifier inverts to `ReentrancyRejected` live ×4 + `GuardEntered` struct-only. Guard-admin events (`GuardInitialized` / `GuardAdminReset` / `AllowedCallersUpdated`) absent entirely — zero struct declarations, zero emit sites — matching the 2-of-5-live treasury/task-market admin-side convention but on the runtime axis proof_verifier is the lone outlier.

Field-carrying shape: `vk_id: [u8; 32]` on 5 of 11 (4 VK-lifecycle + `BatchVerified`). `slot: u64` on 2 (`GuardEntered` struct-only + `ReentrancyRejected`). **No `timestamp: i64` field on any event** — proof_verifier is the only program across the 9-cycle §Events sweep without a single timestamp-carrying event (cf. treasury 13-of-14, task-market 12-of-21, agent-registry 9-of-9, etc.). Indexer-side, block time for VK-lifecycle + authority-transfer + pause comes from `program_events.block_time` / `slot`. No `agent_did` on any event (protocol-infrastructure program, not per-agent). `activates_at: i64` on `VkActivationProposed` is the sole i64 timestamp-shape field and is a timelock target, not a wall-clock stamp.

Pre-edit note "no event on `verify_proof`" correct on the happy path; reject path does emit `ReentrancyRejected` ×2 per the Verify-proof bullet above. Pre-edit enumerated 6 of 11 events; 5 were absent (VerifierInitialized, BatchVerified, VkRegistered dual-emit supersession, ReentrancyRejected live ×4, GuardEntered struct-only).

## Errors

- `Unauthorized`
- `Paused`
- `VkAlreadyExists`
- `VkNotFound`
- `VkMismatch` — provided `VerifierKey` account does not match `config.active_vk`
- `PublicInputCountMismatch`
- `PublicInputOutOfField`
- `ProofMalformed` — curve deserialization failure
- `ProofInvalid` — pairing check fails
- `TimelockNotElapsed`
- `NoPendingActivation`
- `ActivationPending`
- `NotProductionVk`
- `NotImplemented`

## Public-input ordering — locked to spec 05

```
index 0: task_hash
index 1: result_hash
index 2: deadline
index 3: submitted_at
index 4: criteria_root
```

Any reorder requires a new circuit, new VK, new rotation. `circuit_label` surfaces the version.

## CU budget (M1 default, reviewer may tighten)

| Instruction | Target |
|---|---|
| `verify_proof` (5 public inputs) | 400k CUs (§2.4) |
| `register_vk` | 30k |
| `propose_vk_activation` | 10k |
| `execute_vk_activation` | 8k |

TaskMarket `verify+settle` budget in §2.1 is ~400k total, so verify_proof lives alone in a dedicated `ComputeBudgetInstruction::SetComputeUnitLimit(500_000)` paired tx, with settle as a separate instruction in the same tx only if CU headroom allows post-optimization. Reviewer to confirm post-benchmark.

Post-SIMD-0334 target (not M1): ~200k CUs per §2.4.

## Invariants

1. `config.active_vk` points to a `VerifierKey` whose account exists and whose `vk_id` matches.
2. `pending_vk` is set ⇔ `pending_activates_at > 0`.
3. `execute_vk_activation` always enforces `now >= pending_activates_at`.
4. `verify_proof` is pure — no account writes.
5. Public-input count of the active VK never changes without a new circuit label.
6. In mainnet mode, a non-production VK can never be activated (enforced at `propose_vk_activation`).
7. `VerifierKey.ic.len() == num_public_inputs + 1` is constructor-enforced and immutable.

## Security checks (backend §5.1 + §5.2)

- **Account Validation:** Anchor seeds + bump on `VerifierConfig`, `VerifierKey`, `GlobalMode`. `verify_proof` asserts `passed_vk.key() == config.active_vk`. Owner = program. Discriminator enforced.
- **Re-entrancy:** `verify_proof` performs no CPI and writes no state. Cannot re-enter anything.
- **Integer Safety:** scalar reduction validated (`< field modulus`) before pairing. Library (Light Protocol) handles curve arithmetic internally with checked ops; version pinned.
- **Authorization:** VK registration + rotation gated on `authority`. Execution of pending rotation is permissionless but only after timelock.
- **Upgrade Safety:** program upgrade authority = Squads 4-of-7, 7-day timelock (§2.6). In-program VK rotation timelock also 7 days per §2.6 "Verifier key rotations via governance".
- **Trusted Setup:** VK bytes originate only from spec 05's MPC ceremony for mainnet (`is_production = true` flag). Devnet/test VKs flagged false; mainnet mode rejects them.
- **Slashing Safety:** N/A.
- **Oracle Safety:** N/A.
- **Token Safety:** N/A.
- **Pause:** blocks `verify_proof` and VK registration. While paused, TaskMarket's settle path rejects — documented as "verifier halt = task stall", not fund loss; timeouts still fire refunds.

## Interactions with spec 07 (TaskMarket)

- TaskMarket CPIs `verify_proof` during `finalize_task`. Passes:
  - Proof a/b/c bytes (64 + 128 + 64)
  - 5 public inputs derived from its own `TaskContract` state: `task_hash`, `result_hash`, `deadline`, `submitted_at`, `criteria_root`.
- TaskMarket validates the response code and transitions `status` accordingly. ProofVerifier itself does not know TaskMarket exists — this is a one-way, stateless call.
- To support both atomic verify+settle (when CU budget allows) and split verify-then-settle (when it doesn't), TaskMarket spec exposes both paths. M1 ships split.

## Done-checklist

- [ ] Program compiles with Anchor 1.0 + Light Protocol bn254 primitives pinned
- [ ] `register_vk` + `propose_vk_activation` + `execute_vk_activation` happy path test
- [ ] Timelock test: execute rejected before, succeeds after, warp clock
- [ ] Mainnet-mode test: activating a `is_production = false` VK rejected
- [ ] `verify_proof` test vectors from spec 05's test SRS (valid proof) → `Ok`
- [ ] `verify_proof` negative tests: flipped bit in proof, tampered public input, wrong VK → `ProofInvalid` / `VkMismatch`
- [ ] Malformed curve point → `ProofMalformed` (not a panic)
- [ ] CU measurement of `verify_proof` logged; within 400k budget
- [ ] `batch_verify_stub` present in IDL, returns `NotImplemented`
- [ ] IDL at `target/idl/proof_verifier.json`
- [ ] Public-input ordering doc block mirrored verbatim in spec 05 and spec 07
- [ ] Security auditor pass; findings closed
