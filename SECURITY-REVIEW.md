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
