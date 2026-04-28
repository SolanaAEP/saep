# SAEP Security Review

This document is the public-facing distillation of SAEP's internal pre-audit substrate. It is **not** an external third-party audit. It is a sanitised consolidation of the multi-pass internal review work that was prepared for paid engagement handoff (OtterSec / Neodyme / Halborn — none currently funded), folded into a single reviewer-facing document so external eyes can read what *has* been reviewed, by whom, with what coverage, and where the honest gaps remain.

References:

- [`SECURITY.md`](./SECURITY.md) — disclosure channels, PGP, severity / response SLA, coordinated-disclosure timeline
- [`BOUNTY.md`](./BOUNTY.md) — phased bug-bounty scope, severity matrix, payout terms, safe-harbor
- [`docs/audit/`](./docs/audit/) — milestone audit packages and freeze-tag references

Status: **v0** — methodology, reentrancy-guard DAG, fuzz-harness coverage, finding ledger, and re-check checklist landed in this revision. Per-program detail sections expand in subsequent revisions; the substrate (per-program audit handoff reports) is already complete internally.

---

## 0. Preamble

### What this document is

A consolidation of:

- 5 per-program internal audit handoff reports for the M1 in-scope programs (capability_registry, agent_registry, treasury_standard, proof_verifier, task_market).
- The cross-program finding manifest indexing every `F-2026-NN` finding from the internal pre-audit pass + follow-up pass + pre-launch hardening sweep.
- Two internal security-pass reports (on-chain expansion across all 10 programs + off-chain services hardening sweep).
- The fuzz-harness coverage built across all 10 programs.

### What this document is not

- It is not a third-party audit. No external auditor has signed off on any program. Engagements with OtterSec / Neodyme / Halborn are unfunded indefinitely.
- It is not a guarantee. The methodology and coverage below describe the work performed, not the absence of remaining bugs.
- It is not a substitute for the multi-party trusted-setup ceremony. The dev-tier verifying key in `circuits/task_completion/build/` is flagged `is_production = false`; the on-chain handler refuses mainnet activation of any non-production VK.
- It is not a substitute for the multi-party multisig ceremony. Squads vault rotation is operationally a manual step; the program upgrade authority on mainnet remains a single deployer key until the ceremony lands.

### Active-development caveat

ConfidentialTransfer integration is in active development on a feature branch in parallel with the live-mint posture (renounced pump.fun-launched primary mint). Surfaces touched by that work — Token-2022 mint extension configuration, fee-collector harvest paths, treasury-side privacy escrow if shipped — are subject to scope change before mainnet activation. The substrate captured below describes the M1-scope primary path (TransferHook + PermanentDelegate + InterestBearing aspirational extensions). When the privacy-extension direction ratifies, the affected sections will be re-versioned.

---

## 1. Methodology

The internal review combined four review modes, applied iteratively across the protocol surface from initial scaffolding through the pre-launch hardening sweep.

### 1.1 Spec-driven review

Every M1 program has a written spec under [`specs/`](./specs/) authored before implementation. Each per-program audit handoff report cross-cites the spec section that motivates each invariant. Spec-vs-code drift is a first-class finding class; the per-program reports surface code-only invariants explicitly (each report has a "(Not in spec)" callout for invariants discovered during review that the spec does not yet enumerate, so external reviewers can ratify them).

### 1.2 Backend §5.1 security checklist

Every program is reviewed against the same 10-section checklist:

1. Account validation (PDA seeds + bump + discriminator + owner)
2. Authorization (signer/authority gates per instruction)
3. Re-entrancy (self-guard + cross-program guard DAG)
4. Integer safety (`checked_*` arithmetic, byte-by-byte field-modulus comparison for ZK paths)
5. Upgrade (program upgrade authority + in-program timelock cadence)
6. Pause (mutating-ix gate + governance carve-outs)
7. Slashing (timelock + per-incident cap + single-outstanding invariant)
8. Token-2022 (`Interface<TokenInterface>` + `transfer_checked` + extension awareness)
9. Oracle (staleness + confidence band + decimal normalisation)
10. PDA spoofing (stored bump, dynamic derivation only at the loader boundary)

Per-program reports score each section against the program's actual surface. N/A is acceptable when the surface is structurally absent (proof_verifier touches no token accounts, capability_registry has no CPI out, etc.).

### 1.3 Finding-driven review

Every issue surfaced during review is recorded in the cross-program manifest with a stable `F-2026-NN` ID, a severity, the program(s) touched, the fix SHA(s), and one of four dispositions: `CLOSED` / `DEFERRED` / `ACCEPTED` / `OPEN`. The manifest is the single source-of-truth; per-program reports cite IDs, do not restate. See §5 below for the consolidated ledger.

### 1.4 Coverage-driven review

Three coverage modes complement the read-through:

- **Per-program deserialisation fuzz harnesses** (`programs/<p>/src/fuzz.rs`) — proptest-driven discriminator + truncation + arbitrary-bytes rejection across every `#[account]` type. Coverage matrix in §4.
- **Property tests** for arithmetic-heavy paths (fee splitting, EWMA reputation, slash bounds, oracle decimal normalisation, swap min-out). Two real findings landed from this lane (see §5).
- **Bankrun-driven Anchor integration tests** for timelock paths (VK rotation 7d, stake withdraw 30d, slash 30d) and the canonical M1 happy-path settlement chain end-to-end.

### 1.5 Off-chain pass

A separate pass (recorded in the off-chain audit report) covers the off-chain services that hold keys or signing authority (`services/indexer`, `services/iacp`, `services/proof-gen`, `services/mcp-bridge`, `services/x402-gateway`) and the client packages (`packages/sdk`, `packages/sdk-ui`, `packages/sak-plugin`). 23 findings landed across that surface; status table in §5.2.

---

## 2. Scope

### 2.1 Programs reviewed

All 10 Anchor programs in `programs/`:

| # | Program | M-tier | Spec | Per-program audit handoff | Fuzz harness |
|---|---|---|---|---|---|
| 1 | `capability_registry` | M1 | `specs/02-program-capability-registry.md` | yes | 17 cases |
| 2 | `agent_registry` | M1 | `specs/03-program-agent-registry.md` | yes | 22 cases |
| 3 | `treasury_standard` | M1 | `specs/04-program-treasury-standard.md` | yes | 27 cases |
| 4 | `proof_verifier` | M1 | `specs/06-program-proof-verifier.md` | yes | 21 cases |
| 5 | `task_market` | M1 | `specs/07-program-task-market.md` | yes | 22 cases |
| 6 | `dispute_arbitration` | M2 | `specs/program-dispute-arbitration.md` | scaffolded; per-program handoff queued for M2 audit prep | 19 cases |
| 7 | `governance_program` | M2 | `specs/program-governance.md` | scaffolded; per-program handoff queued for M2 audit prep | 18 cases |
| 8 | `fee_collector` | M2 | `specs/program-fee-collector.md` | scaffolded; per-program handoff queued for M2 audit prep | 20 cases |
| 9 | `nxs_staking` | M2 | `specs/program-nxs-staking.md` | scaffolded; per-program handoff queued for M2 audit prep | 15 cases |
| 10 | `template_registry` | bonus | (spec retro queued) | scaffolded; per-program handoff queued for M2 audit prep | 14 cases |

The 5 M1 programs are the audit-of-record set for the public bug-bounty v1 scope. The 5 M2 programs are scaffolded with deserialisation fuzz parity but the substantive per-program audit handoff reports are queued for the M2 audit prep window.

### 2.2 Off-chain services reviewed

7 components in the off-chain pass:

- `services/indexer` — Rust event indexer (Yellowstone gRPC + Postgres + Redis pub/sub + Prometheus)
- `services/iacp` — TypeScript message bus (Fastify + WS + Redis Streams + Ed25519 envelope verify)
- `services/mcp-bridge` — TypeScript MCP server exposing SAEP instructions to agent runtimes
- `services/x402-gateway` — TypeScript HTTP 402 settlement gateway
- `packages/sdk` — TypeScript SDK (instruction builders + Jito bundle + staked-RPC submitter + session-JWT verifier)
- `packages/sdk-ui` — React hook layer (SIWS auth, account subscriptions, mutation wrapper with simulate preflight)
- `packages/sak-plugin` — Solana Agent Kit plugin

Two more recently-landed services (`services/discovery`, `services/buyback-bot`, `services/fee-crank`) post-date the off-chain pass; coverage for those is queued.

### 2.3 Cryptographic substrate reviewed

- `circuits/task_completion/task_completion.circom` — 6,043 constraints (post-F-2026-02 rebuild expanding the public-input vector from 5 → 9 fields)
- The on-chain Groth16 verifier (`programs/proof_verifier`), including `pairing.rs` which calls `sol_alt_bn128_group_op` directly
- The dev-tier verifying key in `circuits/task_completion/build/verification_key.json`
- The chunked `init_vk` + `append_vk_ic` upload flow used to fit the larger IC vector inside Solana's 1232-byte single-tx ceiling

The mainnet-grade multi-party trusted-setup ceremony is **out of scope**. The dev-tier ceremony VK is a single-contributor artefact gated `is_production = false` and refused on mainnet by the on-chain handler.

---

## 3. Reentrancy guard DAG

Six of the ten programs (`agent_registry`, `proof_verifier`, `task_market`, `treasury_standard`, `dispute_arbitration`, `nxs_staking`) carry a `ReentrancyGuard` PDA + `AllowedCallers` PDA + a `guard.rs` module implementing two patterns:

1. **Self-guard** — `try_enter` flips `active = false → true` on instruction entry, `exit` flips back on success. Re-entry into the same handler during a CPI fails the `!active` precondition.
2. **Cross-program caller-guard load** — `load_caller_guard(UncheckedAccount)` performs manual owner / discriminator / PDA-derivation / `active == true` checks. This pattern was the F-2026-04 fix: the original `#[account] ReentrancyGuard` declaration in each program failed Anchor's owner check when one program's guard was passed into another's accounts struct (each program owns its own guard PDA). The `UncheckedAccount` + manual-check escape hatch is the only structurally correct way to pass a sibling program's guard across a CPI boundary under Anchor.

### 3.1 Live CPI edges in the guard DAG (M1)

| Caller | Callee | Caller-side guard | Callee-side guard load | Notes |
|---|---|---|---|---|
| `task_market::verify_task` | `proof_verifier::verify_proof` | self-guard on `verify_task` entry | `load_caller_guard` validates the task_market guard PDA | The sole live CPI-out edge from task_market in M1 |
| `task_market::release` / `expire` | (CPI to agent_registry::record_job_outcome) | (removed, see F-2026-03) | (removed) | This edge was severed in `41d18ff`; reputation now mutates only via the proof-bound rail |
| `proof_verifier::verify_and_update_reputation` | `agent_registry::update_reputation` | self-guard on `verify_and_update_reputation` entry | `load_caller_guard` validates the proof_verifier guard PDA | The proof-bound rail; live since `7c2143c`, gated by `mode.is_mainnet ⇒ vk.is_production` |

### 3.2 Stack-height ceiling

Each guard module enforces an upper bound on `stack_height` when entering the callee. Three programs use `MAX_CPI_STACK_HEIGHT = 3` constant (`treasury_standard::guard.rs`, `proof_verifier::guard.rs`); `agent_registry::reputation.rs` uses a literal `<= 2` on the `update_reputation` callee; `proof_verifier::verify_proof` adds a separate hard `<= 2` check at the handler entry as F-2026-12 hardening (defends against M2 chain expansion). Two distinct upper-bound conventions across the programs is a code-only convention surfaced for external review.

### 3.3 Caller derivation

After F-2026-12, `caller_program` is derived from `current_ix.program_id` (the immediate ix being executed), not from `load_instruction_at_checked(current_index - 1)` against the instructions sysvar. The sysvar lists *top-level* tx instructions, not the CPI stack — attacker-ordering-controlled, not the real caller. The single-level CPI design assumed by SAEP M1 makes `current_ix.program_id` the correct identity. Multi-level CPI chains (e.g. task_market → proof_verifier → agent_registry) are explicitly out of scope at M1 (rejected by the `<= 2` stack-height check above).

### 3.4 Open caveat

The end-to-end cross-program guard DAG (task_market → proof_verifier with a real Groth16 proof under bankrun + caller-guard load on the callee side) is **not yet exercised in an integration test** because the `sol_alt_bn128_group_op` syscall is unavailable in the bankrun environment. The canonical happy-path settlement chain (`tests/e2e_happy_path.ts`) patches task state to `Verified` directly at the verify_task → verify_proof step. Closing this gap needs either solana-test-validator integration coverage of that one CPI edge with a real proof, or upstream bankrun support for the alt_bn128 syscall. This is the §3 rider 4 in the audit-fix manifest's conditional-PASS section and the most material remaining test gap for an external reviewer.

---

## 4. Fuzz-harness coverage matrix

Every program carries a per-program deserialisation fuzz harness at `programs/<p>/src/fuzz.rs`. Each harness exercises every `#[account]` type the program declares with the same family of property tests:

- **Round-trip** — serialise → deserialise → assert equality, per account type
- **Truncation** — buffer truncated at every byte length below the discriminator, must reject
- **Arbitrary-bytes** — random discriminator, must reject (cross-discriminator confusion)
- **Wrong-discriminator** — correct length, wrong discriminator, must reject
- **Random-tail** — correct discriminator, random tail bytes — must not panic; must surface a structured deserialise error

Default proptest invocation count is 256 per case, so the per-program counts below correspond to multiples of 256 randomised runs.

| Program | Cases | Account types covered | Notes |
|---|---|---|---|
| `capability_registry` | 17 | RegistryConfig + CapabilityTag | Smallest surface; no embedded sub-structs |
| `agent_registry` | 22 | RegistryGlobal + AgentAccount + StakeVault claims + PersonhoodAttestation + CategoryReputation + ReentrancyGuard + AllowedCallers + 2 embedded structs | Largest M1 program; 8 PDA types |
| `treasury_standard` | 27 | TreasuryGlobal + AgentTreasury + TreasuryVault + PaymentStream + StreamEscrow + ReentrancyGuard + AllowedCallers | Most cases; oracle / decimal / stream surfaces |
| `proof_verifier` | 21 | VerifierConfig + VerifierKey + BatchState + GlobalMode + ReentrancyGuard + AllowedCallers | Plus 13 proptest cases for arbitrary discriminator rejection |
| `task_market` | 22 | TaskContract + Bid + BidBook + 2 token-account PDAs + 2 embedded guard structs + 3 enums + TaskPayload | Most surface bands of any M1 program |
| `dispute_arbitration` | 19 | DisputeConfig + ArbitratorAccount + DisputePool + DisputeCase + VoteRecord + AppealRecord + PendingSlash | M2 |
| `governance_program` | 18 | GovernanceConfig + ProgramRegistry + ProposalAccount + VoteRecord + ExecutionRecord + EmergencyAction | M2 |
| `fee_collector` | 20 | FeeCollectorConfig + EpochAccount + StakerClaim + 3 vault PDAs | M2 |
| `nxs_staking` | 15 | StakingConfig + StakeAccount + PendingSlash + SnapshotAccount | M2 |
| `template_registry` | 14 | TemplateGlobal + TemplateAccount + RentalAccount + ForkRecord | bonus |

Total: **195 cases × 256 invocations = ~49,920 randomised runs** at default proptest configuration.

### 4.1 What the fuzz harnesses do not cover

The fuzz harnesses target the **deserialisation layer**. They do not exercise the **instruction layer** (wrong-owner / missing-signer / wrong-PDA / cross-program impersonation against a live SVM). Closing that gap requires `mollusk-svm` or `solana-program-test` harness adoption — queued as a separate cycle, not landed at this revision.

### 4.2 Property tests outside `fuzz.rs`

Additional property tests (32 cases across 3 crates) cover arithmetic-heavy surfaces: `task_market::compute_fees`, `agent_registry::ewma` / `assert_slash_bound` / `capability_check`, `treasury_standard::validate_limits` / `unix_day` / `iso_week` / `guard_oracle` / `normalize_to_base_units` / `compute_swap_min_out`. Two real findings landed from these (see §5).

---

## 5. Finding ledger

### 5.1 On-chain findings (`F-2026-NN`)

Every issue surfaced during the on-chain pre-audit pass + follow-up + pre-launch hardening sweep. The internal manifest is the single source-of-truth; this table mirrors it for public reference.

| ID | Severity | Program(s) | Status | Fix SHA |
|---|---|---|---|---|
| F-2026-01 | Critical | agent_registry | CLOSED | `41d18ff` |
| F-2026-02 | Critical | proof_verifier | CLOSED | `7c2143c` (interim fail-close: `41d18ff`) |
| F-2026-03 | High | task_market | CLOSED | `41d18ff` |
| F-2026-04 | High | agent_registry, proof_verifier | CLOSED (spawned F-2026-12) | `41d18ff` |
| F-2026-05 | High | task_market | CLOSED | `41d18ff` |
| F-2026-06 | Medium | task_market, treasury_standard, fee_collector | CLOSED | `41d18ff` |
| F-2026-07 | Medium | task_market | PARTIAL → superseded by F-2026-13 | `41d18ff` |
| F-2026-08 | Medium | task_market | CLOSED | `41d18ff` |
| F-2026-09 | Low | task_market | ACCEPTED | — |
| F-2026-10 | Low | task_market | ACCEPTED → superseded by F-2026-16 | — |
| F-2026-11 | Info | agent_registry | ACCEPTED | — |
| F-2026-12 | Low/Info | agent_registry, proof_verifier | CLOSED | `5f008e8` |
| F-2026-13 | Medium | task_market | CLOSED | `adb3c3a` |
| F-2026-14 | Medium | treasury_standard | CLOSED | `ac0aeb1` |
| F-2026-15 | Medium | treasury_standard | CLOSED | `ac0aeb1` |
| F-2026-16 | Medium | task_market | CLOSED (supersedes F-2026-10) | `ac0aeb1` |

**By disposition:**

- **CLOSED:** 12 (F-2026-01, 02, 03, 04, 05, 06, 08, 12, 13, 14, 15, 16). All have a fix SHA on public `main`.
- **PARTIAL → CLOSED:** 1 (F-2026-07 partially fixed, then fully closed by F-2026-13).
- **ACCEPTED:** 3 (F-2026-09, F-2026-11, F-2026-10 — F-2026-10's structural close landed early as F-2026-16, but the original ACCEPTED verdict stands for the original audit window for trail continuity). Each ACCEPTED entry has a verbatim wontfix-rationale recorded in the internal manifest.
- **DEFERRED:** 0 outstanding. F-2026-02 was DEFERRED for one window (interim fail-close in `41d18ff`) before structurally closing in `7c2143c` after the circuit rebinding + dev-tier ceremony VK + handler reconstruction landed.
- **OPEN:** 0.

### 5.2 Off-chain findings (`OC-*`)

Off-chain services + client packages pass surfaced 23 findings. All 23 closed in the same pre-launch hardening sweep window:

| Severity | Count | Status |
|---|---|---|
| Critical | 2 | CLOSED (auto-sign safety gates on MCP bridge + SAK plugin) |
| High | 5 | CLOSED (indexer auth/CORS/rate-limit, x402 SSRF, IACP timing-safe token compare) |
| Medium | 9 | CLOSED (error-message redaction, keypair permission warning, simulated-settlement mainnet refusal, atomic rate-limit Lua, WS-token transport, IACP topic auth, CORS) |
| Low | 7 | CLOSED (config-debug redaction, ephemeral-keypair guardrails, session-secret length floor, sibling-ix program-id validation, base58 pubkey length check, `Math.random` removal, healthz config leak) |

Two of the seven `Low` findings (`OC-L-01` config-debug redaction, `OC-L-06` `Math.random` removal) are the structural-correctness class an external auditor typically files as `Informational`; severity reflects internal classification, not Immunefi-aligned re-grade.

### 5.3 Two property-test findings

Two non-trivial findings landed from the property-test lane outside the F-2026 numbering (recorded as bug-fixes in the integer-overflow property tests section of the internal substrate):

- `treasury_standard::compute_swap_min_out` and `normalize_to_base_units` used `10u128.pow(combined_exp as u32)`, which panics in debug and silently returns 0 in release for `combined_exp > 38`. The release-mode silent-zero behaviour would yield `min_out = 0` and bypass slippage protection on cross-mint withdrawals when oracle exponents + mint decimals stack against the swap. **Fix:** `checked_pow` + `i64::unsigned_abs().try_into::<u32>()`, returning `ArithmeticOverflow` instead of producing a footgun.

These two are the kind of finding the property-test lane is built to surface: arithmetic correctness across the whole input domain, not just the spec-walked happy path.

---

## 6. What an external auditor would re-check

This section enumerates the surfaces an external reviewer engaged to ratify the internal substrate would prioritise. It is the audit-prep punch-list inverted to face outward — what to look at first, with our framing for why.

### 6.1 Cross-program guard DAG end-to-end

The single most material remaining test gap. `tests/e2e_happy_path.ts` covers every link in the M1 settlement chain except the one CPI edge that requires the `sol_alt_bn128_group_op` syscall (verify_task → verify_proof with a real Groth16 proof). Closing the gap with either solana-test-validator integration or upstream bankrun support for the syscall would substantially strengthen the rest of the chain's coverage. The handler-side reconstruction is exercised via the proof_verifier standalone test fixture, so the gap is integration-only — the unit-level surface is covered.

### 6.2 Stack-height upper-bound conventions

Three programs with a `MAX_CPI_STACK_HEIGHT` ceiling, two distinct conventions (`= 3` constant in `treasury_standard::guard.rs` and `proof_verifier::guard.rs`; `<= 2` literal in `agent_registry::reputation.rs`). External reviewer should ratify (a) whether the two-convention split is intentional and (b) whether `<= 3` is the correct ceiling for M1's single-level-CPI design, given F-2026-12's hard `<= 2` defence.

### 6.3 Token-2022 hook allowlist completeness

F-2026-06 closed the hook allowlist on `commit_bid` / `claim_bond` / `fund_treasury` / `withdraw` / `init_stream`. F-2026-14 closed reentrancy-guard wrap on `fund_treasury` / `init_stream` / `close_stream` / `withdraw`. External reviewer should re-walk every `transfer_checked` site in `programs/` against the hook-allowlist enforcement matrix and verify completeness; a missing site reduces to silent acceptance of an attacker-controlled hook program.

### 6.4 Proof-binding completeness

The F-2026-02 closure expanded the circuit's public-input vector from 5 to 9 fields (added `agent_did`, `capability_bit`, `sample_hash`, `task_id`). External reviewer should re-walk the on-chain handler's public-input extraction and verify (a) the handler does not trust the unsigned `_agent_did` / `_capability_bit` / `_task_id` instruction args (kept for IDL stability per the F-2026-02 closure note), (b) the `sample` is recomputed on-chain via `light-poseidon` and compared against the proof's `sample_hash` commitment, (c) `mode.is_mainnet ⇒ vk.is_production` cannot be bypassed.

### 6.5 ACCEPTED rationale review

Three ACCEPTED findings (F-2026-09, F-2026-10, F-2026-11) have wontfix rationales recorded in the internal manifest. External reviewer should ratify or push back each rationale; ACCEPTED is the disposition class most likely to require renegotiation against an external reviewer's risk model.

### 6.6 Inert / partial-implementation surfaces

The internal substrate enumerates four stub families that compile and have on-chain accounts but do not perform the operation an off-chain caller might expect:

- `task_market::pay_task` — fail-closed (`PayTaskDisabled` error)
- `task_market::raise_dispute` — terminal-state hand-off (escrow frozen until M2 dispute_arbitration's `execute_dispute_verdict` + `force_release` land)
- `proof_verifier::finalize_batch` — partial implementation (emits `BatchVerified` + closes PDA but does not perform the N+3-pairing reduction; the only stub family whose output is consumable by an off-chain caller in a misleading way; explicitly disclosed in the proof_verifier per-program report and spec 06)
- `agent_registry::record_job_outcome` — callee-retained, all on-chain callers severed per F-2026-03

External reviewer should ratify each disposition (fail-closed / terminal-state / partial-but-misleadingly-named / callee-retained-with-callers-severed) against the spec and confirm no off-chain caller in the SDK / portal / IACP path consumes any of these as truth.

### 6.7 Fuzz harness extension to instruction layer

§4.1 notes the deserialisation harnesses do not cover the instruction layer. External reviewer with `mollusk-svm` or `solana-program-test` familiarity could add wrong-owner / missing-signer / cross-program-impersonation cases against any program in scope. This is structural hardening, not a closure of any specific finding.

### 6.8 Off-chain Critical-class re-test

The two Critical off-chain findings (`OC-C-01` MCP-bridge auto-sign + `OC-C-02` SAK-plugin always-sign) closed via per-tx + velocity caps + mainnet-acknowledge-risk gating. External reviewer should re-attack: prompt-injection against the MCP runtime, large-bid griefing against the SAK runtime, mainnet-cluster gating bypass.

---

## 7. What is *not* audited

A reviewer-honest list of surfaces deliberately outside the substrate above.

### 7.1 Multi-party trusted-setup ceremony

The dev-tier verifying key shipped under `circuits/task_completion/build/verification_key.json` is a single-contributor artefact gated `is_production = false`. The on-chain handler refuses mainnet activation of any non-production VK (`mode.is_mainnet ⇒ vk.is_production`). The mainnet-grade multi-party Phase-2 ceremony (multiple geographically-distributed contributors + reproducible Hermez ptau pinning + post-ceremony attestation) is **not yet performed**. The ceremony spec exists at `specs/ops-trusted-setup.md`; execution is a separate pre-launch operational item, not in the cryptographic-code substrate above.

### 7.2 ZK circuit rigor beyond the rebuild

The 6,043-constraint `task_completion` circuit has been re-bound to the 9-field public-input vector per F-2026-02. External cryptographic-circuit review (ZK-specialist firm — Veridise, Zellic-circom, or comparable) is **not performed**. The substrate covers verifier-side correctness (on-chain pairing, public-input encoding, IC length, scalar field bounds); it does not cover circuit-side soundness, witness-leakage, or the absence of malicious-prover side channels.

### 7.3 Squads multisig ceremony

The on-chain program upgrade authority is currently a single deployer key (per the operator-side mainnet activation runbook). Rotation to a Squads 4-of-7 / 6-of-9 vault with a 7-day timelock is the canonical next step; the multisig configuration spec exists at `specs/ops-squads-multisig.md`. The actual ceremony — geographically-distributed signer key generation, vault initialisation, authority transfer, post-rotation attestation — is **not yet performed**.

### 7.4 Post-mainnet on-chain economy

Six SAEP programs are deployed on mainnet, of which five are initialised. The remaining four (`fee_collector`, `governance_program`, `dispute_arbitration`, `template_registry`) are not deployed. The substrate covers the program code; it does not cover the runtime properties of the live deployed programs (slot density, RPC reliability, reorg behaviour, real-token escrow latency). These are operational properties measurable only against the deployed surface.

### 7.5 Recently-landed services

`services/discovery`, `services/buyback-bot`, and `services/fee-crank` post-date the off-chain pass recorded in §5.2. Their security review is queued; the discovery-API surface is spec-covered (`specs/discovery-api.md`) but the implementation has not been walked against the off-chain checklist above.

### 7.6 Pump.fun-launched primary mint

The live SAEP mint at `HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump` is a renounced Token-2022 mint with two extensions live (`metadataPointer` + `tokenMetadata`). The aspirational extension set in `specs/token2022-saep-mint.md` (TransferHook + PermanentDelegate + InterestBearing + Pausable) **is not currently configured on the live mint** and could not be applied without a new mint launch. The substrate covers the program-side enforcement layer for those extensions; it does not cover the mint itself, which has no upgrade authority by design.

### 7.7 Privacy-extension direction (active development)

ConfidentialTransfer integration is in active development on a feature branch in parallel with the live-mint posture. Surfaces under development on that branch are not part of the substrate above. When the privacy-extension direction ratifies, the affected sections will be re-versioned.

### 7.8 Third-party dependencies

The substrate does not re-audit Anchor, Solana program-runtime, Squads, Light Protocol, Switchboard, Pyth, Jupiter v6, Civic Gateway, Token-2022 mint extensions, or the snarkjs / circom toolchain. Findings that reduce to a third-party dependency are reported upstream per `SECURITY.md` § Out of scope.

---

## 8. Maintenance contract

This document is refreshed when:

- A new finding lands in the internal substrate (next free `F-YYYY-NN` ID + a row in §5.1, status set on close).
- A finding's disposition flips (CLOSED / DEFERRED / ACCEPTED). Disposition flips require a fix SHA OR an ACCEPTED rationale OR a DEFERRED tracker pointer — never a status change without an audit trail.
- A new program enters the audit-of-record set (e.g. an M2 program reaches the freeze tag for paid engagement handoff).
- A material structural change lands (e.g. circuit rebinding, guard-DAG topology change, off-chain service surface expansion).

External reviewers engaging on any milestone should treat the per-program audit handoff reports + the cross-program finding manifest as the substantive substrate; this document is the navigable index. The substantive material is in [`specs/`](./specs/) for the design surface, in `programs/<p>/src/` for the implementation, and in the milestone audit packages under [`docs/audit/`](./docs/audit/) for the engagement-of-record handoff.

---

## Appendix A — Per-program detail folds

Per-program detail mirroring the substrate's PDA + instruction + invariant + security-checks shape, public-sanitised. v0 of this document landed §0–§9 as a navigable index; the appendix below layers per-program content one program per revision. Programs not yet folded carry their full surface in the substrate above (§2.1 row + §4 fuzz row + §5.1 finding row); folding only consolidates that material into a per-program reading order.

### A.1 capability_registry

One-sentence summary: capability_registry is the single source-of-truth for the `u128` capability bitmask that every agent declares. It has no CPI out, no token surface, no oracle dependency, no settlement authority — it governs the *set* of bits other programs may read. Smallest of the 5 in-scope M1 programs and the cleanest review surface; zero `F-2026-NN` findings touched it.

#### A.1.1 Program identity

- **Program ID:** `GW161Wce7z4S2rdcSCPNGixn2YQajefNc4r3jUj9zZ5F` (`programs/capability_registry/src/lib.rs` `declare_id!`).
- **Spec:** [`specs/02-program-capability-registry.md`](./specs/02-program-capability-registry.md).
- **Upgrade authority on mainnet:** single deployer key today; rotation to a Squads vault with a 7-day timelock per [`specs/ops-squads-multisig.md`](./specs/ops-squads-multisig.md) is the canonical next step (operational, not yet performed — see §7.3).
- **In-program `authority` (mutating-ix gate):** placeholder Pubkey supplied at `initialize`, migrating to the GovernanceProgram PDA once the M2 governance flow is initialised.

#### A.1.2 PDAs

Two PDAs. Both fixed-width — every variable-length surface is a `[u8; N]` with null-padding for rent determinism.

**`RegistryConfig` — global singleton.** Seeds `[b"config"]`. Fields (`state.rs`):

- `authority: Pubkey` — mutating-ix gate.
- `approved_mask: u128` — bitmask of currently approved tags.
- `tag_count: u8` — monotonic, max `MAX_TAGS = 128`.
- `pending_authority: Option<Pubkey>` — two-step transfer buffer.
- `paused: bool` — emergency pause.
- `bump: u8`.

**`CapabilityTag` — one per tag.** Seeds `[b"tag", &[bit_index]]` (single 1-byte index = up to 128 PDAs). Fields:

- `bit_index: u8` — bounded to `< 128` at `propose_tag`.
- `slug: [u8; 32]` — ASCII lowercase `[a-z0-9_]`, null-padded.
- `manifest_uri: [u8; 96]` — IPFS or Arweave URI, null-padded.
- `added_at: i64`, `added_by: Pubkey`, `retired: bool`.
- `min_personhood_tier: u8` — 0 None / 1 Basic / 2 Verified (mirrors `agent_registry`'s tier as a raw u8 to avoid a cross-program type dependency).
- `bump: u8`.

#### A.1.3 Instructions

Nine instructions, all live — no stubs, no `NotImplemented` paths.

| # | Instruction | Signer | Mutates | CPI out |
|---|---|---|---|---|
| 1 | `initialize(authority)` | deployer (payer) | creates `RegistryConfig` | none |
| 2 | `propose_tag(bit_index, slug, manifest_uri)` | `authority` | creates `CapabilityTag`; sets bit; increments `tag_count` | none |
| 3 | `retire_tag(bit_index)` | `authority` | sets `tag.retired`; clears bit | none |
| 4 | `update_manifest_uri(bit_index, manifest_uri)` | `authority` | rewrites `tag.manifest_uri` | none |
| 5 | `transfer_authority(new_authority)` | `authority` | sets `pending_authority` | none |
| 6 | `accept_authority()` | `pending_authority` | promotes pending → authority | none |
| 7 | `set_paused(paused)` | `authority` | toggles `config.paused` | none |
| 8 | `validate_mask(mask)` | any | readonly — `assert_mask_approved` | none |
| 9 | `set_tag_personhood(bit_index, min_tier)` | `authority` | rewrites `tag.min_personhood_tier` | none |

**No CPI out of capability_registry.** This is the smallest trust surface in M1: other programs CPI *into* it (or replicate its check inline — see A.1.5) but it never initiates a call. That alone eliminates reentrancy, callee-impersonation, and caller-attestation classes the other M1 programs must defend against.

#### A.1.4 Events

Seven events, all decoded by `services/indexer` against the committed IDL: `RegistryInitialized`, `TagApproved`, `TagRetired`, `TagManifestUpdated` (also emitted on `set_tag_personhood` since the tag's governance envelope changed), `AuthorityTransferProposed`, `AuthorityTransferAccepted`, `PausedSet`. All seven covered by the indexer's borsh round-trip harness.

#### A.1.5 Cross-program consumption

capability_registry is a **read target**, not a caller. Two consumers at M1:

1. **agent_registry** (`register_agent`, `update_manifest`) — reads `RegistryConfig` PDA directly via Anchor `seeds = [b"config"], seeds::program = global.capability_registry` and enforces `mask & !approved_mask == 0` *inline* (no CPI). Rationale: a read-only CPI would cost ~1k CU for a single u128 comparison; inlining saves the call. The `validate_mask` handler still exists for off-chain simulation + tooling.
2. **task_market** (`commit_bid` after F-2026-08, `create_task`) — does not read capability_registry directly. It reads the *agent's* `capability_mask` field and asserts `(mask >> task.payload.capability_bit) & 1 == 1`. Trust chain: capability_registry approves bit → agent_registry enforces bit-in-approved-mask at registration → task_market assumes the mask is already vetted (subject to A.1.6 invariant 5 on retirement).

Third-party reads (indexer, portal, analytics) fetch `RegistryConfig` via RPC and decode against the IDL; no program-level surface.

#### A.1.6 Invariants

1. `popcount(approved_mask) + retired_count == tag_count` at all times. Enforced by: `propose_tag` sets the bit + increments `tag_count`; `retire_tag` clears the bit + sets `tag.retired = true` but never decrements `tag_count`.
2. No `CapabilityTag.bit_index >= 128`. Enforced at `propose_tag` via `require!(bit_index < MAX_TAGS)`.
3. Once retired, a bit is never re-approved. Enforced by the PDA seed `[b"tag", &[bit_index]]`: once the PDA exists, `propose_tag` cannot create it again (Anchor returns "account already in use"). Retirement is permanent.
4. `authority` is never the zero pubkey post-`initialize`. **Note:** the handler accepts whatever `authority: Pubkey` the deployer passes — there is no `require!(authority != Pubkey::default())` guard. The invariant holds operationally (deployer passes a real pubkey), not statically.
5. Agents registered against bit `b` remain queryable even after bit `b` is retired. `retire_tag` only flips `tag.retired` + clears the bit in `approved_mask`; it does not touch `AgentAccount.capability_mask` on any agent. Agents registered before retirement keep the bit and remain valid for already-accepted tasks; new `register_agent` / `update_manifest` calls reject the retired bit. Forward-only retirement.
6. **Not in spec:** `validate_mask` runs on an unauthenticated `Accounts` context — deliberately permissionless so off-chain tools can query approval without a signer. No state mutation possible on this path.

#### A.1.7 Security checks (§1.2 mapping)

- **Account validation.** Every handler declares `seeds = [b"config"]` + `bump = config.bump` on `RegistryConfig`; every tag-touching handler declares `seeds = [b"tag".as_ref(), &[bit_index]]` + `bump = tag.bump`. Anchor discriminator enforced at `Account<'info, T>` deserialisation on every handler.
- **Authorization.** All mutating instructions gate on `has_one = authority`. `initialize` is one-shot via PDA init (a second call returns Anchor "account already in use"). Two-step authority transfer prevents lockout-on-typo. `set_paused` is authority-gated. `accept_authority` gates on `pending_authority` key equality, not the current authority — correct for handoff.
- **Re-entrancy.** No CPI out. `validate_mask` is readonly. N/A by construction; capability_registry does not carry a `ReentrancyGuard` PDA because the outbound surface that would need one does not exist.
- **Integer safety.** `tag_count` uses `checked_add`. Bitmask set/clear via `1u128 << bit_index` after `require!(bit_index < 128)` — no `checked_shl` needed since the shift amount is bounded by the require. `assert_mask_approved` is a single bitwise `&` + `!` + `!= 0` check, no arithmetic.
- **Upgrade.** Program upgrade authority rotates to a Squads vault before mainnet per ops spec. In-program `authority` migrates to the GovernanceProgram PDA in M2.
- **Pause.** `config.paused` is checked at every mutating handler *except* the authority-handoff pair + `set_paused` itself, so a paused registry can still accept governance handoff and unpause (no lockout). `validate_mask` is not pause-gated — pause blocks writes, not reads.
- **No Token-2022 surface.** capability_registry does not touch any mint, token account, transfer hook, or fee authority.
- **Oracle.** None.
- **PDA spoofing.** Every PDA-carrying ix uses Anchor's `seeds = [...]` + `bump = <stored>.bump` pattern; the stored `bump` is set at init and consumed on every subsequent read. No `find_program_address` at runtime.
- **Discriminator enforcement.** Fuzz-tested across 17 cases (`src/fuzz.rs`): arbitrary-discriminator rejection on both `RegistryConfig` and `CapabilityTag`; truncated-buffer rejection; full-byte-tail no-panic; round-trips on both account types; total-function checks on `bit_mask` + `validate_slug` + `validate_manifest_uri`.

#### A.1.8 Known stubs

**None.** All 9 instructions have live handlers. No `NotImplemented` paths. No feature-flagged branches. capability_registry does not appear in §6.6 (inert / partial-implementation surfaces).

For completeness (not stubs, but out-of-scope for this section): `scripts/seed_capabilities.ts` is an off-chain script that calls `propose_tag` for the M1 initial tag set at devnet bring-up. Governance wiring (in-program `authority` handover from multisig to `GovernanceProgram` PDA) lands in M2 with the GovernanceProgram scaffold; the existing `transfer_authority` / `accept_authority` pair is the mechanism, only the *destination* changes.

#### A.1.9 Test coverage

**Rust unit + proptest (`cargo test -p capability_registry`).** `src/state.rs` carries 11 unit tests (validators including embedded-null rejection, `bit_mask` bounds, set/clear round-trip, `assert_mask_approved` subset / unapproved / retired-bit cases). `src/fuzz.rs` carries 17 fuzz cases (per the §4 matrix).

**Anchor TS integration (`tests/capability_registry.ts`).** 22 cases across 8 describe blocks: `initialize` (happy + duplicate-init rejection), `propose_tag` (happy + Unauthorized + BitIndexOutOfRange + InvalidSlug uppercase + empty-URI + duplicate-bit), `update_manifest_uri` (happy + unauthorized + empty-URI), `set_paused` (toggle behaviour + paused-ix-rejected + unauthorized), `validate_mask` (subset accept + unapproved reject), `retire_tag` (happy + already-retired reject + retired-bit validate-rejection), `transfer_authority` / `accept_authority` (NoPendingAuthority + wrong-signer + correct-rotation + reverse-rotation), batch (32 tags registered without overflow), invariants (program ID parity).

**Coverage gap (known, not hidden).** `set_tag_personhood` is not exercised under Anchor integration tests; unit-level coverage via `src/fuzz.rs` round-trip on the `min_personhood_tier` field. No bankrun adapter — no timelock in capability_registry (authority handoff is two-step-but-instant, not delayed), so bankrun would add no coverage.

#### A.1.10 Finding-ledger filter

Zero `F-2026-NN` findings touched capability_registry. The §5.1 ledger has no row attributing to this program.

### A.2 agent_registry

One-sentence summary: agent_registry holds every agent's identity, stake, status, and per-capability reputation. It is the trust anchor every other M1 program reads or calls into — task_market reads `AgentAccount` inline; proof_verifier CPIs `update_reputation`. Largest program in the audit-of-record set (28 public instructions, 8 PDA types, 43 error variants), the only one holding value directly (per-agent stake vault + global slashing-treasury target), and the one with the largest `F-2026-NN` footprint (4 findings touched per §5.1: F-2026-01 / 04 / 11 / 12).

#### A.2.1 Program identity

- **Program ID:** `EQJ4Lp2gxJDD5hs185aDcermYWdAi4cQeSKfnuqLAQYu` (`programs/agent_registry/src/lib.rs` `declare_id!`).
- **Spec:** [`specs/03-program-agent-registry.md`](./specs/03-program-agent-registry.md).
- **Upgrade authority on mainnet:** single deployer key today; rotation to a Squads 4-of-7 vault with a 7-day timelock per [`specs/ops-squads-multisig.md`](./specs/ops-squads-multisig.md) is the canonical next step (operational, not yet performed — see §7.3).
- **In-program `authority` (`RegistryGlobal`):** begins as the deployer-supplied pubkey at `init_global`, rotates via two-step `transfer_authority` / `accept_authority`; migrates to the GovernanceProgram PDA once the M2 governance flow is initialised.

#### A.2.2 PDAs

Eight PDA types — the most of any M1 program. All fixed-width `#[derive(InitSpace)]`; no `String` on-chain; every variable-length surface is `[u8; N]` with null-padding for rent determinism.

- **`RegistryGlobal`** — governance singleton. Seeds `[b"global"]`. Carries: `authority` + `pending_authority` (two-step transfer); cross-program ID pins (`capability_registry`, `task_market`, `dispute_arbitration`, `slashing_treasury`, `stake_mint`, `proof_verifier`); risk knobs (`min_stake`, `max_slash_bps` hard-capped at `MAX_SLASH_BPS_CAP = 1000`, `slash_timelock_secs` default 30 days); personhood config (`allowed_civic_networks` + `allowed_sas_issuers` allowlists, `personhood_basic_min_tier`, `require_personhood_for_register`, `civic_gateway_program` with the F-2026-01 fail-close default); `paused` kill-switch; `bump`.
- **`AgentAccount`** — per-`(operator, agent_id)`. Seeds `[b"agent", operator, agent_id]` where `agent_id: [u8; 32]`. Carries `operator`, `agent_id`, `did = keccak256(operator || agent_id || manifest_uri[..first_null])` (deterministic, **not** attacker-chosen), `manifest_uri: [u8; 128]`, `capability_mask: u128` (subset of capability_registry's `approved_mask` at registration time per A.1.6 invariant 5), pricing fields, counters (`jobs_completed >= jobs_disputed` invariant), `stake_amount` mirroring `StakeVault.amount`, `status` (4-state machine), monotonic `version`, optional `delegate` (secondary signer for `set_status` only), embedded `pending_slash` + `pending_withdrawal`, `bump` + `vault_bump`.
- **`StakeVault`** — per-agent Token-2022 ATA. Seeds `[b"stake", agent_did]`. Mint = `RegistryGlobal.stake_mint`; authority is the PDA itself (self-signing via `vault_bump`). Written by `register_agent`, `stake_increase`, `stake_withdraw_execute`, `execute_slash`.
- **`PersonhoodAttestation`** — per-operator Civic / SAS binding. Seeds `[b"personhood", operator]`. Carries `operator`, `provider` (Civic | SAS), `tier` (None | Basic | Verified), `gatekeeper_network`, `attestation_ref = keccak256(token_pubkey || slot)` (replay binding against token reuse), `attested_at`, `expires_at`, `revoked`, `bump`. One attestation per operator (PDA seeds); `is_valid_at(now)` checks `!revoked && now <= expires_at`.
- **`CategoryReputation`** — per-agent-per-capability EWMA. Seeds `[b"rep", agent_did, &capability_bit.to_le_bytes()]` (bit as u16 → 2-byte LE). Carries `agent_did`, `capability_bit`, `score` (6-dim EWMA each `0..=10_000` bps + `alpha` + `sample_count` + `last_update`), `jobs_completed`, `jobs_disputed`, `last_proof_key: [u8; 32]`, `last_task_id: [u8; 32]` (replay-protection field — see F-2026-11 disposition note in §5.1), `version = CATEGORY_REP_VERSION = 1`, `bump`. Rail live since `7c2143c` (F-2026-02 closure); the mainnet-ceremony gate (`mode.is_mainnet ⇒ vk.is_production`) is a separate spec-06 ceremony-discipline check, not an F-2026-02 rider.
- **`ReentrancyGuard`** — singleton CPI guard. Seeds `[b"guard"]`. Self-defense pattern matching the §3 DAG. `admin_reset` requires `propose_guard_reset` + `ADMIN_RESET_TIMELOCK_SECS = 86_400` (24h) timelock, so a stuck-active guard cannot be cleared faster than the proposal window.
- **`AllowedCallers`** — singleton caller allowlist. Seeds `[b"allowed_callers"]`. `programs: Vec<Pubkey>` capped at `MAX_ALLOWED_CALLERS = 8`. Consumed by `update_reputation` callee-preconditions only — callers must appear here, **and** hold an active guard of their own, **and** land at CPI stack height ≤ 2.
- Embedded sub-structs (no distinct PDA): `PendingSlash { amount, reason_code, proposed_at, executable_at, proposer, appeal_pending }` (`executable_at = proposed_at + slash_timelock_secs`; `appeal_pending` reserved for M2 dispute_arbitration); `PendingWithdrawal { amount, requested_at, executable_at }` (same 30-day timelock).

#### A.2.3 Instructions

28 public instructions plus one deprecated stub (`record_job_outcome` retained for IDL stability — see A.2.8). Grouped by concern.

- **Registry init** (1 ix): `init_global(...)` validates `max_slash_bps <= 1000` + `slash_timelock_secs > 0`.
- **Agent lifecycle** (5 ix): `register_agent` (computes `did`, runs the inline capability check via Anchor `seeds::program = global.capability_registry` + asserts `mask & !approved_mask == 0` — see A.1.5 for the inline-vs-CPI rationale; optional personhood gate); `update_manifest`; `delegate_control`; `set_status` (operator-or-delegate; Active↔Paused only — Deregistered transition is operator-only); `record_job_outcome` (deprecated stub per F-2026-03; export retained, body removed, all callers severed).
- **Stake management** (3 ix): `stake_increase`; `stake_withdraw_request`; `stake_withdraw_execute`. The 30-day withdrawal timelock matches the slash timelock and blocks while `pending_slash.is_some()`. Post-withdraw, if `stake_amount < min_stake`, status flips to `Deregistered`.
- **Slashing** (3 ix): `propose_slash` (authority-gated; per-incident cap enforced as `amount * 10_000 <= max_slash_bps * stake` against live stake); `cancel_slash` (authority-gated; the **only** mutating ix allowed under `global.paused` — explicit carve-out so a pause cannot lock in an erroneous slash); `execute_slash` (permissionless crank; re-checks the cap against live stake; transfers via `Token2022::transfer_checked` PDA-signed to `slashing_treasury` ATA; flips status to `Suspended` if post-slash stake < `min_stake`).
- **Governance setters** (8 ix, all `has_one = authority`): `transfer_authority` / `accept_authority` (two-step); `set_min_stake`; `set_max_slash_bps` (`<=1000` enforced against the const cap); `set_slash_timelock_secs` (`>0` enforced); `set_paused`; `set_civic_gateway_program` (the F-2026-01 gate — must be set before personhood works); `set_proof_verifier`.
- **Reputation rail** (1 ix): `update_reputation(...)`. The bound callee of `proof_verifier::verify_and_update_reputation`. Preconditions: CPI depth ≤ 2 (hard `require!`), caller program in `AllowedCallers`, caller-side `ReentrancyGuard.active == true`, self-guard inactive. Live since `7c2143c`. The upstream caller verifies the 9-public-input Groth16 proof, reconstructs `agent_did` / `capability_bit` / `sample_hash` / `task_id` from `public_inputs[5..9]`, recomputes the on-chain Poseidon sample via `light-poseidon`, then CPIs in with the verified values; caller-supplied `_agent_did` / `_capability_bit` / `_task_id` instruction args are ignored (name-prefixed `_` for IDL stability post-F-2026-02).
- **Personhood** (4 ix): `attest_personhood` (asserts `civic_gateway_token.owner == global.civic_gateway_program` per F-2026-01 fail-close before reading any token field; first-slot civic network ⇒ `Verified`, other allowed networks + SAS issuers ⇒ `Basic`; replay-binding `attestation_ref = keccak256(token_pubkey || slot)`); `revoke_personhood` (authority); `refresh_personhood` (operator); `set_gatekeeper_allowlist` (authority — wholesale replacement matching governance cadence).
- **Reentrancy guard management** (4 ix): `init_guard`; `set_allowed_callers`; `propose_guard_reset`; `admin_reset_guard` (24h timelock; exists because a failed CPI could leave the guard stuck `active = true`).

#### A.2.4 Events

23 events in `events.rs` (`#[event]`), all decoded by `services/indexer` against the committed IDL: registry + lifecycle (`GlobalInitialized`, `AgentRegistered`, `ManifestUpdated`, `DelegateSet`, `StatusChanged`, `JobOutcomeRecorded`); stake (`StakeIncreased`, `WithdrawalRequested`, `WithdrawalExecuted`); slash (`SlashProposed`, `SlashCancelled`, `SlashExecuted`); governance + personhood (`GlobalParamsUpdated`, `PersonhoodAttested`, `PersonhoodRevoked`, `PersonhoodRefreshed`, `GatekeeperAllowlistUpdated`); guard (`GuardEntered`, `ReentrancyRejected`, `GuardInitialized`, `GuardAdminReset`, `AllowedCallersUpdated`); reputation (`CategoryReputationUpdated`). All 23 covered by the indexer's borsh round-trip harness.

`JobOutcomeRecorded` remains on the dead `record_job_outcome` stub for IDL stability — never emitted at runtime since F-2026-03 severed all callers.

#### A.2.5 Cross-program consumption

**CPI out** — only to Token-2022, via `anchor_spl::token_2022::transfer_checked`. Four call sites: `register_agent` (operator ATA → `StakeVault`, operator-signed); `stake_increase` (operator ATA → `StakeVault`, operator-signed); `stake_withdraw_execute` (`StakeVault` → operator ATA, PDA-signed via `vault_bump`); `execute_slash` (`StakeVault` → `slashing_treasury` ATA, PDA-signed). No CPI to capability_registry, proof_verifier, task_market, dispute_arbitration, treasury_standard, or any SAEP program — capability-bit enforcement is the inline cross-program-account read described in A.1.5.

**CPI in** — one entry point: `proof_verifier::verify_and_update_reputation` → `agent_registry::update_reputation`. Gated by the F-2026-04 caller-guard-load pattern: `caller_guard: UncheckedAccount` validated via `load_caller_guard` (manual owner + PDA + discriminator + `active` checks), caller program in `AllowedCallers`, caller CPI stack height ≤ 2. The historical edge `task_market::release` → `agent_registry::record_job_outcome` was severed in `41d18ff` per F-2026-03 — caller side fully removed, callee retained as a dead stub for IDL stability.

**Read targets** (inline reads, no CPI in either direction): `task_market` reads `AgentAccount` directly via Anchor `seeds::program = global.agent_registry` on `create_task` / `submit_result` / `release` / `expire` / `close_bidding` / `claim_bond`, verifying against `agent_did` / `operator` / `status` / `min_stake`; `task_market` also reads `PersonhoodAttestation` inline on `accept_task`. The inline-read pattern saves ~2k CU per call against an equivalent read-only CPI.

#### A.2.6 Invariants

1. **`AgentAccount.stake_amount == StakeVault.amount` at every instruction boundary.** Maintained by symmetry of writes: every state mutation (`stake_amount +=` / `-=`) happens *before* the `transfer_checked` CPI, with the CPI amount matching the delta. A failed CPI aborts the whole instruction (Anchor error propagation), so a partial update is structurally impossible. **Known coverage gap:** no Anchor integration test currently asserts symmetry on a happy path against localnet — see A.2.9.
2. **`jobs_completed >= jobs_disputed` always.** Both `checked_add`'d in the reputation rail.
3. **`status == Deregistered` is terminal in M1.** No `close_agent` handler exists; `stake_withdraw_execute` can flip status to `Deregistered` when post-withdraw stake < `min_stake`, with no path out until the M2 `close_agent` lands.
4. **`pending_slash.amount <= stake_amount` at proposal and execution.** Both checks use a `u128` intermediate (`amount * 10_000 <= max_slash_bps * stake`) — no overflow on realistic inputs since max `u64 * 10_000 < u128::MAX`.
5. **`pending_slash.executable_at - proposed_at == slash_timelock_secs` at proposal.** Computed via `now + global.slash_timelock_secs` with `checked_add` on `i64`. `executable_at` is stored, not recomputed, so clock drift cannot retroactively shift the timelock.
6. **Reputation dimensions ∈ `[0, 10_000]`.** Enforced per-update in the reputation handler. Rail live since `7c2143c` (F-2026-02 closure); the M1 dev-tier ceremony means no production samples land yet, but the bounds-check code path is the same one the production rail will use post-real-ceremony.
7. **`AgentAccount.version` strictly monotonic.** `update_manifest` does `version = version.checked_add(1)?`; `register_agent` sets `version = 1`.
8. **Only `operator` can shrink stake; only `authority` (or program-PDA) can slash.** `stake_withdraw_*` is operator-gated; `propose_slash` / `cancel_slash` are authority-gated; `execute_slash` is the permissionless crank but state-gated (cannot execute without a prior authority-signed `propose_slash`).
9. **`did` is deterministic; two agents cannot share a DID.** PDA seeds `[b"agent", operator, agent_id]` guarantee account uniqueness; `did = keccak256(operator || agent_id || manifest_uri[..first_null])` is a function of the seeds + manifest. Collision reduces to a keccak preimage attack — out of scope.
10. **Not in spec:** single-outstanding rule on `pending_slash` *and* `pending_withdrawal`. Spec §2.1 mentions the single-pending-slash invariant; the parallel rule on withdrawal is enforced in code only (`stake_withdraw_request` returns `WithdrawalPending` if one already exists). Without it, a second withdrawal could race the first's timelock window.

#### A.2.7 Security checks (§1.2 mapping)

- **Account validation.** Every handler declares `seeds = [b"agent", operator, agent_account.agent_id]` + `bump = agent_account.bump` on `AgentAccount`; `seeds = [b"global"]` + `bump = global.bump` on `RegistryGlobal`. `StakeVault` is a token account — owner enforced by Anchor's `TokenAccount` type (Token-2022 program). Cross-program PDAs use explicit `seeds::program = ...`. The `load_caller_guard` runtime-check pattern replaces Anchor's compile-time owner check for guards owned by *other* SAEP programs — the single place where the Anchor default is structurally insufficient.
- **Authorization.** Operator-only: `update_manifest`, `delegate_control`, `stake_*`, `attest_personhood`, `refresh_personhood`. Operator-or-delegate: `set_status` (Active↔Paused only). Authority-only: all governance setters + `propose_slash` / `cancel_slash` + `revoke_personhood` + `set_gatekeeper_allowlist` + guard management. Permissionless crank: `execute_slash` (state-gated). Program-only via CPI guard: `update_reputation`.
- **Re-entrancy.** The most intricate surface in M1. Self-defense: `register_agent`, `stake_increase`, `stake_withdraw_execute` each `try_enter` at the top and `exit` before return. Callee-defense (`update_reputation`): `check_callee_preconditions` enforces stack height ≤ 2 (hard `require!` in `reputation.rs`; the `MAX_CPI_STACK_HEIGHT = 3` constant in `guard.rs` is a stricter outer bound for other callees but reputation uses the tighter `2` — see §3.2 + §6.2). State mutations happen *before* the `transfer_checked` CPI on all four stake paths — a reentrant call would see updated state. F-2026-04 closed the Anchor-owner-check footgun; F-2026-12 closed the sysvar-derivation footgun.
- **Integer safety.** `checked_*` arithmetic on `stake_amount`, `jobs_*`, `version`, EWMA dims. Slash-bound check uses a `u128` intermediate. `ArithmeticOverflow` is the uniform error on fall-through.
- **Upgrade.** Deployer → Squads 4-of-7 with 7-day timelock per ops spec before mainnet. In-program `authority` migrates to GovernanceProgram PDA in M2.
- **Pause.** `global.paused` checked on every state-changing ix *except* `cancel_slash` (Invariant 10 carve-out — pause must not trap a mistaken slash) and the authority-handoff pair (`transfer_authority` / `accept_authority` — pause must not trap governance handoff). `execute_slash` *is* pause-gated. `update_reputation` is pause-gated indirectly via the proof_verifier caller refusing to initiate during pause.
- **Slashing safety.** 30-day default timelock (governance-adjustable, `>0`), 10% per-incident cap (hard-coded `MAX_SLASH_BPS_CAP = 1000`), single-outstanding rule (Invariant 10), `cancel_slash` allowed during pause. `appeal_pending` reserved for M2 dispute_arbitration — never set in M1.
- **Token-2022.** Stake mint is expected to be a plain Token-2022 mint at M1; `transfer_checked` uniformly enforces mint + decimals (blocks the "wrong mint" swap class). Hook-allowlist enforcement on agent_registry's four CPI sites is M2 work, coupled with the M2 hook-allowed stake mint.
- **Oracle.** None. agent_registry has no Pyth / Switchboard reads.
- **PDA spoofing.** Every PDA-carrying ix uses Anchor's `seeds = [...]` + `bump = <stored>.bump` pattern; bumps stored at init, consumed on every subsequent ix. `StakeVault` PDA signature uses the stored `vault_bump` (not `find_program_address` at runtime).
- **Discriminator enforcement.** 22 fuzz cases (per §4 matrix) cover the four primary account types (`RegistryGlobal`, `AgentAccount`, `PersonhoodAttestation`, `CategoryReputation`): arbitrary-disc rejection, truncated-buffer rejection, correct-disc + random-tail no-panic, pairwise disc-distinctness, round-trips on the full randomised field space.

#### A.2.8 Known stubs

- **`record_job_outcome`.** Deprecated per F-2026-03. Handler body removed; export retained for IDL stability through the audit window. No call sites — the historical caller (`task_market::release`) was severed in `41d18ff`. Reference code retained at `lifecycle.rs` as a dead branch for audit-trail readability. Listed under §6.6 as the "callee-retained, all on-chain callers severed" entry.
- **`update_reputation`.** Live handler since `7c2143c` (F-2026-02 closure). End-to-end coverage in M1 is dev-tier only — proofs against the production-tier ceremony VK arrive post-real-ceremony per §7.1.

No other stubs. No feature-flagged branches. No `NotImplemented` paths.

#### A.2.9 Test coverage

**Rust unit + proptest (`cargo test -p agent_registry`).** `src/state.rs` carries ~20 inline unit tests (EWMA convex bound, slash-bound arithmetic, capability-check subset / superset, slug validation, status-machine transitions, personhood-tier ordering, attestation `is_valid_at`). `src/fuzz.rs` carries a 256-case proptest block covering round-trip on the four primary account types, arbitrary-discriminator rejection per type, truncated-buffer rejection, correct-discriminator + random-tail no-panic, pairwise discriminator-distinctness, and a `RegistryGlobal` trailing-bytes case documenting the Anchor "parse succeeds + slice non-empty" contract.

**Anchor TS integration (`tests/agent_registry.ts`).** Two active cases (program-ID parity, agent-PDA derivation determinism); six fixture-gated `.skip`'d cases for `register_agent` capability rejection, stake-vault deposit, slash 10% cap, slash 30-day timelock (bankrun-required), 2-step withdrawal (bankrun-required), and reputation EWMA bounds (rail live but integration test still needs capability_registry + Token-2022 mint fixture + dev-tier proof artefact).

**Coverage gaps (known, not hidden).** No bankrun adapter for the slash 30-day warp (the VK-rotate bankrun adapter at `tests/helpers/bankrun.ts` is the template; scaling to agent_registry needs the shared capability_registry + stake-mint fixture first). No localnet cross-program guard DAG test — unit-tested `load_caller_guard` + `check_callee_preconditions` pass; integration coverage of task_market → proof_verifier → agent_registry under Anchor localnet is the §3.4 / §6.1 gap. The six skipped Anchor cases above are each fixture-gated, not design gaps; the planned closure is one cycle to land the shared fixture, then unskip in one motion.

#### A.2.10 Finding-ledger filter

Four findings touched agent_registry. Citations are IDs only; full entries live in §5.1.

- **F-2026-01** (Critical, CLOSED). Personhood: `civic_gateway_token.owner` check fail-close. The deployer must call `set_civic_gateway_program` before `attest_personhood` works; the handler returns `CivicGatewayProgramNotSet` otherwise.
- **F-2026-04** (High, CLOSED, spawned F-2026-12). Cross-program `ReentrancyGuard` owner-check footgun: `update_reputation` accepts the caller-side guard as `UncheckedAccount` and validates via `load_caller_guard`. Closure landed the runtime-check pattern documented in §3 + §6.2.
- **F-2026-11** (Info, ACCEPTED). `CategoryReputation` replay scheme rejects only the immediate-prior `task_id`. The rail was previously fail-closed per F-2026-02 (now CLOSED in `7c2143c`); the single-prior `last_task_id` replay-protection is a known gap with a documented expansion path (bloom-filter migration). Not exploitable in M1 (dev-tier ceremony, no production proofs land).
- **F-2026-12** (Low / Info, CLOSED). `caller_program` derivation hardened to `current_ix.program_id` + hard `stack_height <= 2` rejection. Also touched `proof_verifier::verify_proof` per §3.3.

The conditional-PASS rider relevant to agent_registry — that the cross-program guard DAG lacks a localnet integration test — is the §3.4 / §6.1 caveat above.

### A.3 task_market

One-sentence summary: task_market is the M1 escrow + lifecycle program. Clients fund tasks, agents (or commit-reveal bid winners) submit results, proof_verifier gates settlement, funds release minus protocol + SolRep fees with a 24h dispute window, and unverified tasks expire-refund the client. 26 public instructions across 8 concern groups, 5 `#[account]` PDAs + 1 token-account PDA + 2 embedded guard structs, 58 errors, 21 events, the sole live CPI-out edge in M1 (to `proof_verifier::verify_proof`), and the largest `F-2026-NN` footprint of any in-scope program (9 findings touched per §5.1: F-2026-03 / 05 / 06 / 07 / 08 / 09 / 10 / 13 / 16).

#### A.3.1 Program identity

- **Program ID:** `HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w` (`programs/task_market/src/lib.rs` `declare_id!`).
- **Spec:** [`specs/07-program-task-market.md`](./specs/07-program-task-market.md).
- **Upgrade authority on mainnet:** single deployer key today; rotation to a Squads 4-of-7 vault with a **14-day timelock** per [`specs/ops-squads-multisig.md`](./specs/ops-squads-multisig.md) is the canonical next step (operational, not yet performed — see §7.3). The 14-day cadence is intentional and longer than the 7-day cadence used on the other four M1 in-scope programs because task_market is the critical-path settlement surface; spec 07 §Security-checks ratifies the longer window.
- **In-program `authority` (`MarketGlobal`):** begins as the deployer-supplied pubkey at `init_global`; two-step `transfer_authority` / `accept_authority`; migrates to the GovernanceProgram PDA once the M2 governance flow is initialised.

#### A.3.2 PDAs

5 `#[account]` types in `state.rs` + 1 SPL token-account PDA + 2 embedded reentrancy structs in `guard.rs`. All `#[account]`s are fixed-width `#[derive(InitSpace)]`; no `String` on-chain. 3 enums + 1 embedded payload struct.

- **`MarketGlobal`** — governance singleton. Seeds `[b"market_global"]`. Carries `authority` + `pending_authority` (two-step transfer); cross-program ID pins (`agent_registry`, `treasury_standard`, `proof_verifier`, `fee_collector`, `solrep_pool`); fee bps (`protocol_fee_bps`, `solrep_fee_bps`, each capped at `MAX_*_FEE_BPS = 100` = 1%); `dispute_window_secs` (24h spec default); `max_deadline_secs`; `allowed_payment_mints: [Pubkey; 8]` fixed-width whitelist; `paused`; `hook_allowlist: Pubkey` pointer to fee_collector's `HookAllowlist` PDA (`Pubkey::default()` = unwired warn-only mode); `bump`.
- **`TaskContract`** — per-task escrow + state. Seeds `[b"task", client, task_nonce: [u8; 8]]` (caller-chosen nonce permits many concurrent tasks per client). Carries `task_id: [u8; 32]` (Poseidon-bound public-input from spec 05), `client`, `agent_did: [u8; 32]` (rewritten to winning bidder's DID in `close_bidding` per F-2026-05), `payment_mint`, `payment_amount`, `protocol_fee` + `solrep_fee` (computed at `create_task` from bps × amount via u128 intermediate), result + proof + criteria fields, `milestone_count` (`<= MAX_MILESTONES = 8`; M1 single-shot, multi-milestone reserved for M2), `status: TaskStatus` (9-variant state machine), timestamps (`created_at` / `funded_at` / `deadline` / `submitted_at` / `dispute_window_end`), `verified: bool`, `bid_book: Option<Pubkey>` (`Some` when commit-reveal is in use), `assigned_agent: Option<Pubkey>` (winning bidder operator after `close_bidding`), `payload: TaskPayload` (typed-task: `TaskKind` discriminant + `capability_bit: u16` + bounded `criteria: Vec<u8>` `<= MAX_CRITERIA_LEN = 128` + `requires_personhood: PersonhoodTier`), `bump`, `escrow_bump`.
- **`TaskEscrow`** — per-task SPL Token-2022 account. Seeds `[b"task_escrow", task.key()]`. Token account, not an `#[account]` — authority is the PDA itself (program signs as the authority on transfers out). Mint = `task.payment_mint`. Holds gross `payment_amount` while `status ∈ {Funded, ProofSubmitted, Verified, Disputed}`; drained to 0 on `Released | Expired` (Invariant 1).
- **`BidBook`** — per-task commit-reveal phase state. Seeds `[SEED_BID_BOOK, task_id]`. Carries `commit_start` / `commit_end` / `reveal_end` (default `300s` commit + `180s` reveal), `bond_amount`, `bond_mint`, `commit_count`, `reveal_count`, `winner_agent`, `winner_bidder`, `winner_amount`, `phase: BidPhase` (Commit / Reveal / Settled / Cancelled — Settled / Cancelled terminal). Optional on `TaskContract`; direct-assignment tasks never instantiate one.
- **`Bid`** — per-bidder commit + bond record. Seeds `[SEED_BID, task_id, bidder]`. Carries `agent_did`, `bidder`, `commit_hash: [u8; 32]` (`reveal_commit_hash(amount, nonce, agent_did)` via keccak256), `bond_paid: u64`, `revealed_amount`, `revealed`, `refunded`, `slashed`, `bump`. Capacity capped at `MAX_BIDDERS_PER_TASK = 64`. PDA persists across the bidding round; not closed at `claim_bond` per the original F-2026-10 disposition (subsequently superseded by F-2026-16 — see §5.1 + A.3.10).
- **`BondEscrow`** — per-task SPL Token-2022 account for bidder bonds. Seeds `[SEED_BOND_ESCROW, task_id]`. Token account; PDA-owned. Mint = `BidBook.bond_mint`. Closed by `cancel_bidding` after refund loop completes.
- **`MintAcceptRecord`** — per-mint Token-2022 vetting record. Seeds `[SEED_MINT_ACCEPT, mint]`. Carries `mint_accept_flags: u64` bitfield (TransferHook present, ConfidentialTransfer present, frozen state, permanent_delegate set), `hook_program: Pubkey` (the mint's TransferHook target if any, validated against `fee_collector::HookAllowlist`), `accepted_at_slot` + `accepted_at_ts`, `bump`. Set by `allow_payment_mint`; rejects mints with disallowed extensions.
- **Embedded** (no distinct PDA): `ReentrancyGuard` + `AllowedCallers` in `guard.rs`. Same shape as the agent_registry / proof_verifier / treasury_standard guard pair. `ReentrancyGuard` carries `active`, `entered_by`, `entered_at_slot`, `reset_proposed_at`, `bump`. `AllowedCallers.programs: Vec<Pubkey>` capped at 8. **M1 state:** `AllowedCallers` is empty by design (no live CPI-in caller in M1; surface present so M2 callers — DisputeArbitration `force_release` + governance `emergency_pause` — can be admitted without a program upgrade).

#### A.3.3 Instructions

26 public instructions, grouped 8-way by concern.

- **Init** (1): `init_global(...)` — deployer-signed one-shot; cross-program pointers + fees + windows + initial allowed mints.
- **Task lifecycle** (3): `create_task` (validates `!paused`, mint allowlisted, deadline bounds, `milestone_count <= 8`, capability bit `<= MAX_CAPABILITY_BIT = 127`, criteria length; inline cross-program AgentAccount read enforces `did == agent_did`, `status == Active`, `stake >= min_stake`; computes fees via u128 intermediate); `fund_task` (status must be `Created`; Token-2022 `transfer_checked` client → escrow; **state-before-CPI** sets `status = Funded` before transfer; hook allowlist enforced per F-2026-06); `cancel_unfunded_task` (5-min `CANCEL_GRACE_SECS` prevents MEV cancellation during Jito bundle retry).
- **Submission + verification** (2): `submit_result` (operator-signed; status must be `Funded`, `now <= deadline`; inline AgentAccount read — when `task.bid_book.is_some()` validates against `task.assigned_agent` per F-2026-05, else against pre-declared `task.agent_did`; self-guard); `verify_task` (permissionless crank; sole CPI-out site — invokes `proof_verifier::verify_proof` with the locked public-input order from spec 06: `[task_hash, result_hash, deadline, submitted_at, criteria_root]`, i64 timestamps encoded as 32-byte big-endian scalars; on Ok flips `status = Verified` + sets `dispute_window_end`; on Err status unchanged + `VerificationFailed` event; runs in dedicated CU tx).
- **Settlement** (3): `release` (permissionless crank; status must be `Verified`, `now >= dispute_window_end`; **state-before-CPI** sets `status = Released` before any transfer; computes `agent_payout = payment_amount - protocol_fee - solrep_fee` via `checked_sub`; three Token-2022 `transfer_checked` calls with hook-allowlist gate at each site; **F-2026-03 retirement:** the historical `record_job_outcome` CPI to agent_registry has been severed — reputation now mutates only through the proof-bound rail described in A.2.5); `expire` (permissionless crank; status must be `Funded` or `ProofSubmitted`, `now > deadline + EXPIRE_GRACE_SECS = 3600`; refunds full `payment_amount` to client; same state-before-CPI + F-2026-03 retirement); `raise_dispute` (client-signed; status must be `Verified`, `now < dispute_window_end`; sets `status = Disputed`, freezes escrow; M2 dispute_arbitration adds the `Disputed → Resolved` transition via `execute_dispute_verdict` + `force_release`).
- **Commit-reveal bidding** (6): bidding is orthogonal to direct-assignment; client opens `bid_book` post-`fund_task`, runs commit + reveal windows, `close_bidding` rewrites `task.agent_did` to the winning bidder's DID, then settlement proceeds normally. `open_bidding` (client-signed; bond bps `[50, 500]` = 0.5%–5%); `commit_bid` (bidder-signed; inline AgentAccount read enforces `did == agent_did` + `status == Active`; **F-2026-08:** enforces `(agent.capability_mask >> task.payload.capability_bit) & 1 == 1`; personhood gate `enforce_personhood(resolve_required_tier(payload, capability_min_tier), attestation, bidder, now)`; Token-2022 `transfer_checked` from bidder → bond_escrow with hook-allowlist gate); `reveal_bid` (recomputes `keccak256(amount.to_le_bytes() || nonce || agent_did)` and asserts equality with stored `commit_hash`); `close_bidding<'info>()` (permissionless crank; **F-2026-07 + F-2026-13:** enforces `remaining_accounts.len() == reveal_count * 2`, duplicate-bidder rejection, and a hard `require!(bid.revealed && !bid.slashed, InvalidBidInEnumeration)` on every enumerated pair so a sacrificial committed-but-unrevealed bid cannot displace an honest revealed one; winner via `bid_beats(amount, stake, key)` — lowest amount, tie-break highest stake, tie-break smallest pubkey; rewrites `task.agent_did` to winner DID); `claim_bond` (loser refund path, no `Bid` PDA close in M1 — see §5.1 F-2026-10 + supersedure F-2026-16); `cancel_bidding` (pre-settle escape hatch).
- **Governance** (5): `set_allowed_mint(slot, mint)` (low-level slot write); `allow_payment_mint(slot)` (vets a Token-2022 mint via `inspect_mint_extensions`; rejects TransferHook unless allowlisted, frozen state, permanent_delegate set); `set_hook_allowlist_ptr(hook_allowlist)` (one-time wire of `MarketGlobal.hook_allowlist`; immutable post-set); `set_fees(protocol_fee_bps, solrep_fee_bps)` (each `<= 100` = combined 2% ceiling); `set_paused(paused)`.
- **Authority** (2): `transfer_authority` / `accept_authority` (two-step; not pause-gated so a paused program cannot lock out governance handoff).
- **Reentrancy guard management** (4): `init_guard(initial_callers)`; `set_allowed_callers(programs)`; `propose_guard_reset()`; `admin_reset_guard()` — same 24h `ADMIN_RESET_TIMELOCK_SECS` pattern as agent_registry / treasury_standard / proof_verifier.

**No live disabled handlers.** Different from agent_registry's `record_job_outcome` (dead-stub callee, callers severed), treasury_standard's `pay_task` (fail-closed callee), and proof_verifier's `verify_and_update_reputation` (rail live since `7c2143c` with dev-tier coverage). The F-2026-03 retirement on `release` + `expire` was a **caller-side** removal — the CPI is gone; no fail-close handler remains in task_market.

#### A.3.4 Events

21 events in `events.rs`, all decoded by `services/indexer` against the committed IDL: `GlobalInitialized`, `TaskCreated`, `TaskFunded`, `TaskCancelled`, `ResultSubmitted`, `TaskVerified`, `VerificationFailed`, `TaskReleased`, `TaskExpired`, `DisputeRaised`, `GlobalParamsUpdated`, `PausedSet`, `BidBookOpened`, `BidCommitted`, `BidRevealed`, `BidBookClosed`, `BidSlashed`, `TaskPayloadStored`, `MintAccepted`, `GuardEntered`, `ReentrancyRejected`. All 21 covered by the indexer's borsh round-trip harness.

10 events match spec 07 §Events; 11 post-date the spec and are M1 extensions (the 5 bidding events + `TaskPayloadStored` + `MintAccepted` + 2 guard events + `GlobalInitialized` + `TaskCancelled`). All 11 will be back-ported to spec 07 §Events at the same revision that ratifies the bidding + payload extensions.

#### A.3.5 Cross-program consumption

**CPI out — one live edge.** task_market is the largest CPI-out fan-out program in M1 by intent (spec 07 §Interactions enumerates calls to AgentRegistry + ProofVerifier + TreasuryStandard) but only one CPI edge actually lands in M1:

- **`task_market::verify_task` → `proof_verifier::verify_proof`.** Sole `cpi::` import in the program. Public inputs in locked spec 06 order. proof_verifier validates task_market's `caller_guard` via `load_caller_guard` (the F-2026-04 runtime-check pattern — counterpart documented in A.2.5 callee side).

The other two spec-enumerated CPI surfaces have been removed or deferred:

- `task_market → agent_registry::record_job_outcome` — REMOVED from `release` + `expire` per F-2026-03 (closing the proofless reputation-write side-channel). Inline retire-comments in both handlers prevent re-adding the call without a manifest cross-reference.
- `task_market → treasury_standard::pay_task` — DISABLED on the callee side (the callee returns `PayTaskDisabled` always; intentional M1 → M2 IDL stability). task_market does not invoke it.

**CPI in — none live in M1.** `AllowedCallers` is empty by design. Surface present (see A.3.2) so M2 callers can be admitted without a program upgrade.

**Inline cross-program reads** (no CPI in either direction):

- `AgentRegistry::AgentAccount` — read inline at `create_task`, `submit_result`, `commit_bid` via Anchor `seeds::program = global.agent_registry`. Same cross-program PDA-validated read pattern documented in A.2.5 (callee side). When `task.bid_book.is_some()`, `submit_result` + `release` validate against `task.assigned_agent` instead of `task.agent_did` (F-2026-05 winner-DID branch).
- `fee_collector::HookAllowlist` — read inline at every Token-2022 transfer site via `assert_hook_allowed_at_site(mint, site)`. 9 transfer sites all gated.

#### A.3.6 Token-2022 surface

9 `transfer_checked` call sites across `fund_task` (1: client → escrow), `release` (3: escrow → agent / fee_collector / solrep_pool), `expire` (1: escrow → client refund), `commit_bid` (1: bidder → bond_escrow), `claim_bond` (1: bond_escrow → bidder refund), `close_bidding` (2 in the slash loop: bond_escrow → fee_collector for slashed losers). Every site preceded by `assert_hook_allowed_at_site` per F-2026-06. All `transfer_checked` invocations pass explicit `decimals` matching the mint's stored decimals — the Token-2022 invariant that blocks the "wrong mint" swap class.

`allow_payment_mint` vets mints via `inspect_mint_extensions` and rejects: TransferHook unless explicitly allowlisted, ConfidentialTransfer (excluded under the M1 mint posture), frozen state, permanent_delegate set. Same Token-2022 vetting pattern as treasury_standard's per-mint checks.

#### A.3.7 Invariants

10 invariants: 9 from spec 07 §Invariants + 1 not-in-spec-but-in-code (#10), per the per-program convention of surfacing code-only invariants explicitly.

1. **Escrow balance == `payment_amount`** while `status ∈ {Funded, ProofSubmitted, Verified, Disputed}`; **0** after `Released | Expired | Resolved`. Enforced via state-before-CPI in release / expire (Invariant 7) + `EscrowMismatch` sanity check post-transfer.
2. **`protocol_fee + solrep_fee < payment_amount` always.** Bps caps `MAX_*_FEE_BPS = 100` ensure this for any `payment_amount > 0` (max combined 200 bps = 2%). `compute_fees` proptest covers no-overflow + sum-strictly-less + monotonicity-in-bps + zero-bps + zero-amount-rejected.
3. **Every state transition emits exactly one event.** Enforced by handler discipline.
4. **`status == Verified` ⇒ `proof_verifier::verify_proof` returned Ok** on the stored `(task_hash, result_hash, deadline, submitted_at, criteria_root)`. Status only mutates on the Ok branch.
5. **`release` cannot execute before `dispute_window_end`.** Hardcoded check.
6. **`expire` cannot execute while `status ∈ {Verified, Released, Expired, Disputed, Resolved}`.** Hardcoded `WrongStatus` rejection.
7. **No instruction can move escrow funds without first setting terminal status** on `TaskContract` (Released / Expired). State-before-CPI pattern, enforced at the four handlers that touch escrow.
8. **`record_job_outcome` is called exactly once per task lifetime.** Post F-2026-03 this invariant is **vacuously satisfied at zero calls** in M1; the M2 reputation rail restores the spec-intended single-call semantic.
9. **`agent_did` on task matches the `agent_did` of the signer's AgentAccount at `submit_result`** — F-2026-05 extends this: when `bid_book.is_some()`, the comparison is against `task.assigned_agent.agent_did` (winner DID), not the original `task.agent_did`.
10. **Not in spec:** **`bid_book.is_some()` ⇒ `phase ∈ {Settled}` is required for `submit_result` to proceed.** Code at `submit_result` enforces. Spec 07 §State-machine doesn't enumerate the bidding-overlay path; surfacing the rule explicitly because a future contributor might assume `bid_book.is_some()` paths skip status checks.

#### A.3.8 Security checks (§1.2 mapping)

- **Account validation.** All 5 `#[account]` PDAs declare `seeds = [...]` + use stored `bump`. Token accounts (`TaskEscrow`, `BondEscrow`) validated via the Token-2022 program with mint + authority constraints. Cross-program pointers stored in `MarketGlobal` and hard-equality-checked at the CPI / inline-read site, never passed by the caller. The two guard structs use manual discriminator + owner checks for cross-program loads (the F-2026-04 runtime-check pattern, mirrored from agent_registry / proof_verifier).
- **Authorization.** Client-signed paths (`create_task`, `fund_task`, `cancel_unfunded_task`, `open_bidding`, `cancel_bidding`, `raise_dispute`): `has_one = client` or `client: Signer`. Authority-signed paths (governance, two-step transfer, guard mgmt): `has_one = authority`. Operator-signed (`submit_result`): inline AgentAccount read + `operator == agent.operator`. Bidder-signed (`commit_bid`, `reveal_bid`, `claim_bond`). Permissionless cranks (`verify_task`, `release`, `expire`, `close_bidding`): no signer requirement, gated entirely by status + time + cross-program guard. Personhood gate at `commit_bid`. No ambient authority anywhere.
- **Re-entrancy.** Critical surface — task_market is the largest CPI-out program in M1 by surface area (1 live CPI-out edge + 9 Token-2022 transfer sites + 3 inline AgentAccount reads + per-site fee_collector hook check). Self-guard `try_enter` / `guard_exit` on the 6 handlers that touch CPI (`submit_result`, `verify_task`, `release`, `expire`, `commit_bid`, `claim_bond`, plus implicit on `close_bidding` via its slash-loop transfers). **State-before-CPI** (Invariant 7) on every escrow-touching path: terminal status is written before any transfer; spec 07 §Re-entrancy explicitly mandates this ordering. **Cross-program parity callout:** task_market uses **only the const `MAX_CPI_STACK_HEIGHT = 3`** in `guard.rs`, no separate handler-local literal. Across the 4 M1 programs that carry guard surface (agent_registry / treasury_standard / proof_verifier / task_market) two distinct upper-bound conventions exist — agent_registry's `update_reputation` uses `<= 2`, proof_verifier carries both, treasury_standard + task_market use only the const `3` — flagged in §3.4 as the binder's last surface to consolidate.
- **Integer safety.** Fee math via u128 intermediate + `checked_mul` / `checked_add` (`compute_fees` in `state.rs`). Payout math via `checked_sub` chaining. Bond computation via u128 + `checked_mul`. Deadline arithmetic via `checked_add` against i64 bounds. `ArithmeticOverflow` is the uniform error on fall-through. No `unchecked_*` calls. No `pow` / `checked_pow` surfaces — task_market does not compute on user-supplied integers across mint decimals (treasury_standard does — that surface is where the `checked_pow` real finding landed under §1.4 property tests).
- **Upgrade.** Squads 4-of-7 + **14-day timelock** before mainnet (longer than the 7-day cadence on the other M1 programs; spec 07 §Security-checks ratifies the longer window for the critical-path settlement program).
- **Pause.** `MarketGlobal.paused` checked on `create_task`, `fund_task`, `release`, `open_bidding`. **Carve-outs (exit-path liveness):** `expire`, `raise_dispute`, `verify_task`, `submit_result`, `close_bidding`, `claim_bond`, `cancel_unfunded_task`, `cancel_bidding` all run while paused so funds cannot be trapped indefinitely. Same exit-path-invariant principle as treasury_standard. Spec 07 §Pause explicitly mandates the wider carve-out.
- **Slashing.** N/A directly — task_market does not slash agent stake. Bid bonds are slashed at `close_bidding` via Token-2022 transfers (bond_escrow → fee_collector); intra-program bond conservation, not cross-program slashing. Agent reputation + stake slashing live in agent_registry.
- **Token-2022.** 9 `transfer_checked` sites all pass explicit `decimals`. Hook allowlist enforced at every site via `assert_hook_allowed_at_site` (F-2026-06 closure). `allow_payment_mint` vetting documented in A.3.6.
- **Oracle.** N/A in M1. Spec 07 §Oracle-safety: "no direct oracle use in M1 — TreasuryStandard's Jupiter path is not invoked from TaskMarket in M1." If M2 introduces auto-swap-to-USDC on settle, the Pyth + Jupiter surface from treasury_standard will become in-scope here.
- **PDA spoofing.** Stored-bump pattern on all 5 `#[account]` PDAs. Token-account PDAs use stored `escrow_bump`. Cross-program PDAs (AgentAccount inline reads) use `seeds::program = global.agent_registry` for Anchor-validated derivation.
- **Discriminator enforcement.** Anchor enforces on `Account<T>` deserialisation. `fuzz.rs` carries 22 cases (per the §4 matrix) covering state-machine harness fuzzing — instruction-level discriminator + state-transition fuzz. **Honest gap:** no per-account-type deserialise-layer fuzz parity for `MarketGlobal` / `TaskContract` / `BidBook` / `Bid` / `MintAcceptRecord` (the capability_registry-style + treasury_standard-style round-trip / truncate / arbitrary-discriminator coverage). Surfaced explicitly in A.3.10 rather than hidden.

#### A.3.9 Known stubs

- **No live disabled handlers.** Different from the other M1 programs (see A.3.3 closing). The F-2026-03 retirement was a caller-side removal of the `record_job_outcome` CPI — task_market simply no longer calls the rail.
- **Legacy errors retained for IDL stability.** `OutcomeCpiFailed` (was emitted by the retired `record_job_outcome` CPI path) and `CallerNotTaskMarket` (legacy callee-side guard error from pre-F-2026-04 cross-program ReentrancyGuard typing) both persist in `errors.rs` as harmless unused variants. Removing them would be IDL-breaking; leaving them is additive-no-op. Same retention policy as treasury_standard's `CallerNotTaskMarket` legacy variant.
- **M2 reservations** (not stubs, structurally absent in M1): the `Disputed → Resolved` transition (added by M2 dispute_arbitration via `execute_dispute_verdict` + `force_release` — both will be additive instructions; `Disputed → Resolved` is already enumerated in `TaskStatus`); multi-milestone release (`milestone_count` + `milestones_complete` exist on `TaskContract` but `release` is single-shot in M1).

No `TODO`, `FIXME`, `unimplemented!`, no feature-flagged dead branches.

#### A.3.10 Test coverage

**Rust unit + proptest (`cargo test -p task_market`).** 91 unit tests across 4 files: `state.rs` (52 — including 2 `proptest!` blocks on `compute_fees` + `compute_bond_amount` monotonicity, plus tests for `derive_task_hash` determinism, `TaskPayload` borsh round-trips, `TaskKind` discriminant stability, `MintAcceptRecord` flag-bit coverage, `is_call_target_allowed` edge cases, `bid_beats` ordering, `reveal_commit_hash` per-field sensitivity, capability-bit subset checks, hook-allowlist gate truth-table); `fuzz.rs` (21 — state-machine harness fuzzing; instruction-level discriminator + state-transition fuzz); `guard.rs` (7 — `try_enter` / `exit` round-trip, `check_callee_preconditions` (caller-not-allowlisted / caller-guard-inactive / stack-height > MAX), 24h `assert_reset_timelock` boundary); `personhood.rs` (11 — tier resolution, attestation validation, `enforce_personhood` truth-table, `resolve_required_tier` max-of-payload-and-capability).

**Anchor TS integration.** `tests/task_market.ts` carries 2 active `it()` cases (program-ID parity + `init_global` sanity) + 10 fixture-gated `.skip` cases (full `create → fund → submit → verify → release` flow, expire path, dispute freeze, `set_paused` gate, fee-math edge amounts, capability-mask gate, slashed-agent rejection, insufficient-stake rejection — gated on the cross-program build fixture). `tests/task_market_commit_reveal.ts` carries 8 active `it()` cases (bidding-only flows: window validation, bond + capability + personhood, hash-match, winner selection + DID rewrite, F-2026-13 hard-revealed-only enforcement, refund loop, claim-bond happy + already-refunded, `MAX_BIDDERS_PER_TASK` cap rejection) — these run because they don't require the cross-program rebuild.

**Coverage gaps (known, not hidden).** No deserialise-layer fuzz parity for the 5 `#[account]` types (per the §4 matrix: 22 cases on the state-machine harness, none on per-account-type discriminator + truncation + arbitrary-bytes round-trips); no end-to-end localnet test confirming the full state machine with correct fee splits + agent payout + fee_collector + solrep_pool destinations (all 10 skipped Anchor cases land here); no cross-program integration test (task_market ↔ agent_registry inline read ↔ proof_verifier CPI ↔ fee_collector hook check) — same cross-program-build gap surfaced in A.2.9; bidding enumeration with max 64 bids — O(n²) seen-bidders dedup in `close_bidding` is bounded but not benchmarked on-chain at the 64-bid ceiling; reentrancy guard with 3-level CPI depth — guard unit tests cover the assertion logic, no end-to-end 3-level CPI test exists. The planned closure path is the same shared cross-program fixture that closes A.2.9's six skipped cases — one fixture cycle, then unskip across both files.

#### A.3.11 Finding-ledger filter

9 findings touched task_market — the largest `F-2026-NN` footprint of any in-scope M1 program. Citations are IDs only; full entries live in §5.1.

- **F-2026-03** (High, CLOSED). `record_job_outcome` CPI removed from `release` + `expire`; reputation rail re-routed through the proof-bound path in proof_verifier.
- **F-2026-05** (High, CLOSED). `close_bidding` rewrites `task.agent_did` to the winning bidder's DID; `submit_result` / `release` / `expire` / `claim_bond` branch on `task.bid_book.is_some()` to validate against `assigned_agent` instead of the pre-declared DID.
- **F-2026-06** (Medium, CLOSED, multi-program). Hook-allowlist enforcement on every Token-2022 transfer site; `commit_bid` + `claim_bond` (task_market side); `fund_treasury` + `withdraw` + `init_stream` (treasury_standard side); `SITE_*` constants exposed by `fee_collector::state`.
- **F-2026-07** (Medium, PARTIAL → superseded by F-2026-13). Initial fix added `remaining.len() == reveal_count * 2` + duplicate rejection but the loop still allowed `continue` on unrevealed/slashed bids — a cranker could substitute sacrificial committed bids for honest revealed ones. Closure landed under F-2026-13.
- **F-2026-08** (Medium, CLOSED). `commit_bid` enforces capability-bit-in-agent-mask before bond transfer.
- **F-2026-09** (Low, ACCEPTED). `reveal_bid` does not cap `revealed_amount` against `task.payment_amount` — pure ranking-quality issue, filtered at `close_bidding`, no funds at risk; cranker workaround documented.
- **F-2026-10** (Low, ACCEPTED → structurally superseded by F-2026-16). `claim_bond` did not close `Bid` PDA in M1; rent accumulation across cancelled bids deferred to a housekeeping ix. Subsequent structural fix landed under F-2026-16.
- **F-2026-13** (Medium, CLOSED). `close_bidding` `continue` replaced by hard `require!(bid.revealed && !bid.slashed, InvalidBidInEnumeration)` — every enumerated pair must be a live revealed bid.
- **F-2026-16** (Medium, CLOSED — supersedes F-2026-10). Structural close on the dangling `Bid` PDA path.

The conditional-PASS rider relevant to task_market — that the deserialise-layer fuzz parity is missing for the 5 `#[account]` types and that no localnet end-to-end test runs the full state machine — is the §3.4 / §4 caveat above.

### A.4 treasury_standard

One-sentence summary: treasury_standard is the per-agent custody + spending-limits + payment-streams program. It holds value (per-agent Token-2022 vaults + per-stream escrows), enforces per-tx / daily / weekly limits with USDC-base-units normalisation across mismatched mints, runs same-mint or Jupiter-routed cross-mint stream payouts under Pyth oracle guards, and is the only M1 program with an outbound CPI to a non-pinned external program (Jupiter v6 aggregator). 25 public instructions across 8 concern groups, 5 `#[account]` PDAs + 1 token-account PDA + 2 embedded guard structs, 43 errors, 15 events, 3 `F-2026-NN` findings touched per §5.1 (F-2026-06 / 14 / 15).

#### A.4.1 Program identity

- **Program ID:** `6boJQg4L6FRS7YZ5rFXfKUaXSy3eCKnW2SdrT3LJLizQ` (`programs/treasury_standard/src/lib.rs` `declare_id!`).
- **Spec:** [`specs/04-program-treasury-standard.md`](./specs/04-program-treasury-standard.md).
- **Upgrade authority on mainnet:** single deployer key today; rotation to a Squads 4-of-7 vault with the canonical 7-day timelock per [`specs/ops-squads-multisig.md`](./specs/ops-squads-multisig.md) is the next step (operational, not yet performed — see §7.3).
- **In-program `authority` (`TreasuryGlobal`):** begins as the deployer-supplied pubkey at `init_global`; two-step `transfer_authority` / `accept_authority`; migrates to the GovernanceProgram PDA once the M2 governance flow is initialised. Same pattern as agent_registry / capability_registry / task_market.

#### A.4.2 PDAs

5 `#[account]` types in `state.rs` + 1 SPL token-account PDA per active stream + 2 embedded reentrancy structs in `guard.rs` + 1 embedded enum. All `#[account]`s are fixed-width `#[derive(InitSpace)]`; no `String` on-chain.

- **`TreasuryGlobal`** — governance singleton. Seeds `[b"treasury_global"]`. Carries `authority` + `pending_authority` (two-step transfer); cross-program ID pins (`agent_registry` for the `init_treasury` inline read; `jupiter_program` runtime-validated at `withdraw_earned`); pointers (`allowed_mints` whitelist PDA; `hook_allowlist` fee_collector pointer, **immutable after first set** per F-2026-06); risk knobs (`max_stream_duration` default 30 days; `default_daily_limit`; `max_daily_limit`); `paused` kill-switch; `bump`; `#[max_len(8)] global_call_targets: Vec<Pubkey>` fallback call-target allowlist.
- **`AgentTreasury`** — per-agent wallet state. Seeds `[b"treasury", agent_did]` (`agent_did` is `[u8; 32]`). Carries `agent_did` + `operator` (bound at `init_treasury`, never re-bound); limits (`daily_spend_limit`, `per_tx_limit`, `weekly_limit`); rollover tracking (`spent_today`, `spent_this_week`, `last_reset_day` UTC-day-index from `unix_day`, `last_reset_week` ISO-week-index from `iso_week`); stream state (`streaming_active`, `stream_counterparty: Option<Pubkey>`, `stream_rate_per_sec`) — the bijection enforced by Invariant 4; `bump`.
- **`AllowedTargets`** — per-agent call-target whitelist (optional). Seeds `[b"allowed_targets", agent_did]`. Carries `agent_did` + `#[max_len(32)] targets: Vec<Pubkey>` (`MAX_CALL_TARGETS = 32`) + `bump`. Per-agent override of `TreasuryGlobal.global_call_targets`: when present, authoritative; when absent, the global vec is the fallback. Surfaced as Invariant 8 (not in spec).
- **`PaymentStream`** — escrow + accounting per active stream. Seeds `[b"stream", agent_did, client, stream_nonce]` (`stream_nonce` is `[u8; 8]`, allowing many concurrent client→agent streams). Carries `agent_did` + `client` + `stream_nonce`; mints (`payer_mint`, `payout_mint` — equal for same-mint streams, differ to trigger Jupiter swap path); accounting (`rate_per_sec`, `start_time`, `max_duration`, `deposit_total = rate * max_duration` checked at `init_stream`, `withdrawn` monotonic watermark); `status: StreamStatus`; `escrow_bump` + `bump`. The escrow token account is a separate PDA (`[b"stream_escrow", stream]`) signed via `escrow_bump` for transfers out.
- **`AllowedMints`** — global mint whitelist. Seeds `[b"allowed_mints"]`. Carries `authority` + `#[max_len(16)] mints: Vec<Pubkey>` (`MAX_ALLOWED_MINTS = 16`) + `bump`.
- **Embedded** (no distinct PDA): `StreamStatus` enum (`Active | Closed`, forward-only — `Active → Closed`, no reopen); `ReentrancyGuard` + `AllowedCallers` in `guard.rs` (same shape as the agent_registry / proof_verifier / task_market guard pair). The reentrancy guard surface is wider in this program post-F-2026-14 — see A.4.3.

#### A.4.3 Instructions

25 live public instructions + 1 explicitly disabled M1 (`pay_task`), grouped 8-way by concern.

- **Init** (2): `init_global(authority, agent_registry, jupiter_program, default_daily_limit, max_daily_limit)` (deployer-signed); `init_treasury(agent_did, daily_spend_limit, per_tx_limit, weekly_limit)` (operator-signed; reads cross-program `agent_registry::AgentAccount` via Anchor `seeds::program = global.agent_registry`; enforces `agent.did == agent_did`, `agent.operator == ctx.operator`, `agent.status == Active`).
- **Treasury lifecycle** (3): `fund_treasury(amount)` (permissionless top-up; Token-2022 `transfer_checked` funder ATA → vault; reentrancy-wrapped per F-2026-14; hook-allowlist gate per F-2026-06); `withdraw(amount)` (operator-signed; PDA-signed transfer vault → destination; updates `spent_today` / `spent_this_week` after `apply_rollover`; rejects on `LimitExceeded`; reentrancy-wrapped + hook-allowlist gated); `set_limits(daily, per_tx, weekly)` (operator-signed; `validate_limits` chain check `per_tx ≤ daily ≤ weekly`).
- **Streaming** (3): `init_stream(stream_nonce, rate_per_sec, max_duration)` (client-signed; creates `PaymentStream` + escrow token account; `transfer_checked` client ATA → escrow with `deposit_total = rate * max_duration`; sets `streaming_active = true` + `stream_counterparty = Some(client)`; reentrancy-wrapped + hook-allowlist gated); `withdraw_earned(route_data: Vec<u8>)` (operator-signed; computes `claimable = min(rate * elapsed, deposit_total) - withdrawn`; same-mint path `transfer_checked` escrow → agent vault; cross-mint path `read_oracle` + `guard_oracle` for both feeds + `compute_swap_min_out` + Jupiter v6 `invoke_signed` + balance-before/after assertions; `route_data` length-bounded at `MAX_ROUTE_DATA_LEN = 512` per F-2026-15; the original program-wide reentrancy-guard surface, retained); `close_stream()` (operator OR client; final settle agent-receipts vs client-refund; clears `streaming_active` + `stream_counterparty`; sets `status = Closed`; pause-bypass-allowed because refunds must not be trappable; reentrancy-wrapped + hook-allowlist gated).
- **Governance setters** (8): `add_allowed_mint(mint)` / `remove_allowed_mint(mint)` (`MAX_ALLOWED_MINTS = 16` cap); `set_default_daily_limit(amount)`; `set_max_daily_limit(amount)`; `set_max_stream_duration(secs)`; `set_paused(paused)`; `set_global_call_targets(add, remove)` (`MAX_CALL_TARGETS` cap); `set_hook_allowlist_ptr(hook_allowlist)` (**one-way set** — `HookAllowlistAlreadySet` once non-default; F-2026-06 immutability anchor).
- **Authority** (2): `transfer_authority(new_authority)` / `accept_authority()` (two-step; not pause-gated so a paused program cannot lock out governance handoff).
- **Per-agent call targets** (2): `init_allowed_targets(targets)` / `update_allowed_targets(add, remove)` (operator-signed; bounded by `MAX_CALL_TARGETS = 32`; rejects `InvalidCallTarget`).
- **Reentrancy guard management** (4): `init_guard(initial_callers)`; `set_allowed_callers(programs)`; `propose_guard_reset()`; `admin_reset_guard()` — same 24h `ADMIN_RESET_TIMELOCK_SECS` pattern as the other M1 programs.
- **Task settlement** (1, M1 inert): `pay_task(amount)` returns `PayTaskDisabled` always. Reserved for the M2 `task_market → treasury_standard` settlement CPI; handler skeleton in place for additive wiring without IDL break. Not a stub — the disabled-error contract is intentional.

#### A.4.4 Events

15 events in `events.rs`, all decoded by `services/indexer` against the committed IDL: `TreasuryGlobalInitialized`, `TreasuryCreated`, `TreasuryFunded`, `TreasuryWithdraw`, `LimitsUpdated`, `StreamInitialized`, `StreamWithdrawn`, `StreamClosed`, `AllowedMintAdded`, `AllowedMintRemoved`, `PausedSet`, `SwapExecuted`, `AllowedTargetsUpdated`, `GuardEntered`, `ReentrancyRejected`. All 15 covered by the indexer's borsh round-trip harness.

11 events match spec 04 §Events; 4 post-date the spec and are M1 extensions (`AllowedTargetsUpdated`, `SwapExecuted`, `GuardEntered`, `ReentrancyRejected`). All 4 will be back-ported to spec 04 §Events at the same revision that ratifies the per-agent call-target + Jupiter-swap extensions.

#### A.4.5 Cross-program consumption

**CPI out — three surfaces.**

1. **Token-2022 `transfer_checked`** — 4 active call sites (state-before-CPI per §5.1, hook-allowlist gated per F-2026-06, reentrancy-guard wrapped per F-2026-14): `fund_treasury` (funder ATA → vault); `withdraw` (vault → destination, PDA-signed); `init_stream` (client ATA → escrow); `withdraw_earned` same-mint path (escrow → agent vault); `close_stream` dual transfer (escrow → agent vault, escrow → client refund). Token-program field is `Interface<'info, TokenInterface>` post-F-2026-14 (SPL-token + Token-2022 compat path landed in the same commit as the reentrancy-wrap fix).
2. **Jupiter v6 — `withdraw_earned` cross-mint path only.** `invoke_signed` over caller-supplied `remaining_accounts` + `route_data: Vec<u8>` (length-bounded at 512 bytes per F-2026-15). Escrow PDA is the swap authority. Program-id validated at runtime against `TreasuryGlobal.jupiter_program` (`InvalidJupiterProgram`); executable bit checked. Aggregator program treated as an opaque external — only the balance-before/after deltas are trusted (see A.4.8 Re-entrancy + §6.3). Sole CPI out of any M1 program to a non-pinned external program.
3. **Pyth `PriceUpdateV2` — read-only account access (not CPI).** `read_oracle` deserialises account data manually, validates discriminator `[0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd]` (sha256("account:PriceUpdateV2")[..8]). `guard_oracle` enforces `age ≤ 60s` (`MAX_STALENESS_SECS`), `conf_bps ≤ 100` (`MAX_CONFIDENCE_BPS = 1%`), `price > 0`. Both feeds (payer + payout) optional `UncheckedAccount` in `WithdrawEarned` accounts struct — required only when mints differ. Hand-written parser avoids the borsh 0.10 ↔ 1.x conflict the SDK introduces with Anchor 1.0.

**CPI in — none live in M1.** `pay_task` is reserved for the M2 `task_market → treasury_standard` settlement edge but currently rejects with `PayTaskDisabled`.

**Inline cross-program reads** (no CPI in either direction): `agent_registry::AgentAccount` at `init_treasury` via Anchor `seeds::program = global.agent_registry` — same cross-program PDA-validated read pattern documented in A.2.5 / A.3.5.

#### A.4.6 Token-2022 surface

5 `transfer_checked` call sites enumerated above. `Interface<'info, TokenInterface>` typing covers SPL-token + Token-2022 in stride. Every site preceded by `assert_hook_allowed_at_site` per F-2026-06 closure. Every site reentrancy-wrapped via `try_enter` / `guard_exit` per F-2026-14 closure (4 of the 5 — `withdraw_earned` was already wrapped pre-F-2026-14 because of its Jupiter CPI surface). All `transfer_checked` invocations pass explicit `decimals` matching the mint's stored decimals.

Mint-extension assumptions: standard Token-2022 + optional TransferHook only. ConfidentialTransfer is excluded under the M1 mint posture (Privacy Escrow at M4+ uses a separate mint per [`specs/token2022-saep-mint.md`](./specs/token2022-saep-mint.md) §1.3). No PermanentDelegate. Hook allowlist gates the *hook program ID* but does not introspect the hook's behaviour — see §6.3 for the external-reviewer prompt.

#### A.4.7 Invariants

8 invariants: 7 from spec 04 §Invariants + 1 not-in-spec-but-in-code (#8), per the per-program convention of surfacing code-only invariants explicitly.

1. **No value leak.** `sum(vault balances across all mints) + sum(stream escrow balances) == cumulative(fund - withdraw - close_refunds)` ever. Enforced by state mutations preceding CPI; `transfer_checked` atomicity; balance-before/after on Jupiter swap.
2. **Spending limits enforced.** `spent_today ≤ daily_spend_limit ∧ spent_this_week ≤ weekly_limit` at every instruction boundary post-rollover. `apply_rollover` checks day/week change and resets counters; `withdraw` checks before transfer.
3. **Stream watermark.** `withdrawn ≤ earned_at_now ≤ deposit_total` always. `withdraw_earned` computes `earned = min(rate * elapsed, deposit_total)` then `claimable = earned - withdrawn` with `claimable > 0` check.
4. **Streaming bijection.** `streaming_active ⟺ (stream_counterparty.is_some() ∧ active PaymentStream exists)`. `init_stream` sets both; `close_stream` clears both atomically.
5. **Close conservation.** After `close_stream`, `agent_receipts + client_refund == deposit_total` (rounding into agent share per spec §close).
6. **Oracle gate on swap.** Jupiter swap never proceeds if either feed is `OracleStale`, `OracleConfidenceTooWide`, or `OracleNonPositivePrice`. Same-mint path bypasses oracle entirely.
7. **Limit chain.** `per_tx_limit ≤ daily_spend_limit ≤ weekly_limit` always. `validate_limits` at `init_treasury` and `set_limits`.
8. **Not in spec:** **Per-agent `AllowedTargets`, when present, is authoritative over `TreasuryGlobal.global_call_targets`; when absent, the global vec is the fallback.** Documented as on-chain behaviour in `state.rs::is_call_target_allowed`; covered by 2 unit tests in the inline `mod tests`. Surfaced explicitly because a future contributor might assume per-agent is additive rather than override.

#### A.4.8 Security checks (§1.2 mapping)

- **Account validation.** All 5 `#[account]` PDAs declare `seeds = [...]` + use stored `bump`. Token accounts (vault, stream escrow) validated via the Token-2022 program with mint + authority constraints. Cross-program PDAs (`AgentAccount` inline read at `init_treasury`) use `seeds::program = global.agent_registry` for Anchor-validated derivation — the F-2026-04 lesson that owner-check alone is insufficient for cross-program PDAs is preserved here.
- **Authorization.** Three tiers: (a) `authority` (TreasuryGlobal-stored, two-step transfer) gates all setter ix; (b) `operator` (AgentTreasury-stored at init, never re-bound) gates per-agent ix (`withdraw`, `withdraw_earned`, `set_limits`, `update_allowed_targets`); (c) `client` (PaymentStream-stored) gates `init_stream` (as funder) and is also an accepted signer for `close_stream` (per spec §close — "either party can close"). No ambient authority. No `signer = true` permissive checks.
- **Re-entrancy.** Widest reentrancy-guard surface among the 5 M1 programs post-F-2026-14: 5 of the 25 live handlers wrap the guard (`fund_treasury`, `init_stream`, `close_stream`, `withdraw`, `withdraw_earned`). Original program-wide single-handler design (`withdraw_earned` only — guard entered because Jupiter is the only outbound CPI to a program not in the program-id pin set) was extended in `ac0aeb1` to cover the 4 sibling Token-2022 CPI paths. **State-before-CPI** on every transfer-touching path: limits / watermark / status mutations happen before the inner `transfer_checked`. Self-defence pattern matches the agent_registry guard DAG (per A.2.7). **Cross-program parity callout:** treasury_standard uses **only the const `MAX_CPI_STACK_HEIGHT = 3`** in `guard.rs`, no separate handler-local literal. Same convention as task_market; agent_registry's `update_reputation` uses `<= 2`. Two distinct upper-bound conventions across the 4 M1 programs that carry guard surface — flagged in §3.4 + §6.2 as the binder's last consolidation surface.
- **Integer safety.** `compute_swap_min_out` and `normalize_to_base_units` use u128 intermediate with `checked_pow` + `checked_mul` + `checked_div` — return `ArithmeticOverflow` on any failure. **This is the surface the §5.3 property-test finding landed against:** the original `10u128.pow(combined_exp as u32)` panicked in debug and silently returned 0 in release for `combined_exp > 38`, which would yield `min_out = 0` and bypass slippage protection on cross-mint withdrawals when oracle exponents + mint decimals stack against the swap. Closure landed pre-engagement. All other fee math elsewhere uses `checked_*` per Anchor convention.
- **Upgrade.** Squads 4-of-7 + 7-day timelock at deploy ceremony. In-program `authority` two-step transfer separately controls setter access (M2 → GovernanceProgram PDA).
- **Pause.** `TreasuryGlobal.paused` checked on every mutating ix **except** (exit-path liveness): `close_stream` (refunds must not be trappable by pause — Invariant 4 corollary); `transfer_authority` / `accept_authority` (authority handoff must not be trappable); `admin_reset_guard` (emergency unstick must not be trappable). All other 22 mutating ix reject `Paused`. Same exit-path-invariant principle as task_market's pause carve-outs.
- **Slashing.** N/A — treasury_standard does not slash. Agent stake slashing lives in agent_registry per A.2.8.
- **Token-2022.** 5 `transfer_checked` sites all pass explicit `decimals`. Hook allowlist enforced at every site via `assert_hook_allowed_at_site` (F-2026-06). Reentrancy-guard wrap on every site (F-2026-14). Mint-extension assumptions documented in A.4.6.
- **Oracle.** Pyth `PriceUpdateV2` parser hand-written; discriminator-checked, staleness-gated (60s), confidence-gated (1% bps), sign-gated. Switchboard not currently wired (was scaffolded in spec, not implemented). External reviewer should ratify the cadence assumption — there is no on-chain enforcement that the user paid for the recent crank, only that the data is < 60s old (see §6.3 for the prompt).
- **PDA spoofing.** Stored-bump pattern on every PDA. Cross-program PDAs use `seeds::program` for Anchor-validated derivation.
- **Discriminator enforcement.** Anchor enforces on `Account<T>` deserialisation. `fuzz.rs` carries 27 cases (per the §4 matrix) covering round-trip + truncate + arbitrary-discriminator rejection per all 5 PDA types — same shape as the capability_registry / agent_registry harnesses, fuller than task_market's state-machine-only fuzz harness.

#### A.4.9 Known stubs

- **`pay_task`** — fail-closed M1 (returns `PayTaskDisabled` always). Reserved for the M2 `task_market → treasury_standard` settlement CPI; handler skeleton in place for additive wiring without IDL break. **Not a stub** by the §6.6 definition (no `unimplemented!`, no silent success). Listed under §6.6 as the "fail-closed callee" entry.
- **`CallerNotTaskMarket` legacy error** — defined in `errors.rs` but no handler currently references it. Legacy from the M0 task_market-CPI scaffold, retained for IDL stability through the audit window. Same retention policy as task_market's `OutcomeCpiFailed` legacy variant.
- **No other dead code.** No `TODO`, `FIXME`, `STUB`, or `unimplemented!` in `programs/treasury_standard/src/`. All 25 live `pub fn` exercise their full handler body.

#### A.4.10 Test coverage

**Rust unit + proptest (`cargo test -p treasury_standard`).** 57 unit tests across 3 files: `state.rs` inline `mod proptests` (15 proptest cases at default 256 invocations each = ~3,840 randomised runs covering `validate_limits` chain ordering, `unix_day` / `iso_week` monotonicity, `guard_oracle` no-panic on staleness/confidence boundary, `normalize_to_base_units` extreme exponents, `compute_swap_min_out` same-price identity + monotonicity in claimable + slippage inverse — the surface that produced the §5.3 property-test finding); `state.rs` inline unit tests (9 — target validation, mutation, hook-gate, call-target fallback for Invariant 8 coverage, helper math); `guard.rs` inline tests (7 — caller preconditions, timelock pass/fail, stack-height boundary, dedup, allowed-callers replacement); `fuzz.rs` (27 cases — round-trip + truncated-to-discriminator-only + empty-buffer + arbitrary-discriminator rejection per all 5 PDA types + extra-trailing-bytes Anchor-contract documentation).

**Anchor TS integration.** `tests/treasury_standard.ts` carries 2 active `it()` cases (program-ID parity, PDA derivation determinism) + 8 fixture-gated `.skip` cases (fund→withdraw within / exceeding limits; stream init → time-warp → withdraw_earned same-mint; oracle staleness rejection; oracle confidence rejection; cross-mint Jupiter swap; hook-allowlist mismatch).

**Coverage gaps (known, not hidden).** No localnet integration for the full happy-path stream lifecycle (fund → set_limits → init_stream → time-warp → withdraw_earned same-mint → close_stream); no Jupiter swap end-to-end test (cross-mint path is the highest-CU + most-CPI-fan-out handler in the program; would require a bankrun adapter with mocked Jupiter program or a devnet fork); no hook-allowlist site coverage tests for the full F-2026-06 + F-2026-14 site matrix; `pay_task` disabled-gate not explicitly tested; `admin_reset_guard` 24h timelock path covered by Rust unit tests (`guard.rs`) but no end-to-end Anchor test. The planned closure path is the same shared cross-program fixture that closes A.2.9 / A.3.10 — one fixture cycle, then unskip across all three test files.

#### A.4.11 Finding-ledger filter

3 findings touched treasury_standard. Citations are IDs only; full entries live in §5.1.

- **F-2026-06** (Medium, CLOSED, multi-program). Hook-allowlist enforcement on every Token-2022 transfer site: `fund_treasury` + `withdraw` + `init_stream` (treasury_standard side); `commit_bid` + `claim_bond` (task_market side); `SITE_*` constants exposed by `fee_collector::state`. Co-treated with task_market in A.3.11.
- **F-2026-14** (Medium, CLOSED). Reentrancy-guard wrap extended from `withdraw_earned` only (the original Jupiter-CPI surface) to the 4 sibling Token-2022 CPI paths (`fund_treasury` / `init_stream` / `close_stream` / `withdraw`). A malicious-but-allowlisted hook program could in principle re-enter the treasury surface during the inner `transfer_checked` and observe / mutate half-updated state; not demonstrably exploitable against the M1 hook allowlist (FeeCollector-gated) but the reentrancy-guard DAG invariant required uniform coverage across the CPI-out surface. Same `ac0aeb1` commit also lifted the token-program field from `Program<'info, Token2022>` → `Interface<'info, TokenInterface>` in-stride — SPL-token + Token-2022 compat (the XRP Step 0 swap), not a F-2026-14 fix per se.
- **F-2026-15** (Medium, CLOSED). `withdraw_earned(route_data: Vec<u8>)` accepted unbounded Jupiter route payloads, a DoS-shaped footgun with no legitimate use case (no benign Jupiter route exceeds ~256 bytes). Closure: new `MAX_ROUTE_DATA_LEN: usize = 512` constant + `require!(route_data.len() <= MAX_ROUTE_DATA_LEN, RouteDataTooLong)` immediately after `try_enter`.

The conditional-PASS rider relevant to treasury_standard — that no localnet end-to-end test covers the full stream lifecycle (same shared cross-program fixture gap noted in A.2.9 / A.3.10) and that the Jupiter swap edge has no end-to-end test against a mock or devnet aggregator — is the §3.4 / §4 caveat above.

---

## 9. References

- [`SECURITY.md`](./SECURITY.md)
- [`BOUNTY.md`](./BOUNTY.md)
- [`docs/audit/`](./docs/audit/)
- [`specs/`](./specs/)
- [`circuits/task_completion/`](./circuits/task_completion/)
- [`programs/`](./programs/)
- [`services/`](./services/)
- [`packages/`](./packages/)
