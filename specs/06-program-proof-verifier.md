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

## Events

- `VkRegistered`
- `VkActivationProposed { vk_id, activates_at }`
- `VkActivated`
- `VkActivationCancelled`
- `PausedSet`
- `AuthorityTransferProposed / Accepted`

No event on `verify_proof` (too hot a path; callers emit their own settlement events).

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
