# Autonomous session blockers

## 2026-04-16 — pre-audit-03 full-workspace `anchor build` fails on `task_market` — CLOSED 2026-04-16

- **What:** `anchor build` (no `--program-name`) failed in `programs/task_market/src/state.rs:113` with `no method named try_to_vec found for reference &state::TaskPayload`.
- **Resolution:** task_market subagent finished wiring `TaskPayload` serialization. Full-workspace `anchor build` now green on all 7 programs; `cargo test -p task_market --lib` reports 71/71.

## 2026-04-16 — F-2026-02 proof_verifier reputation public-input binding (Critical, deferred)

- **What:** Internal audit 2026-04-16 flagged `proof_verifier::verify_and_update_reputation` as accepting caller-controlled `(agent_did, capability_bit, sample, task_id)` alongside a Groth16 proof whose public inputs do not bind those fields. Any caller holding any valid proof could write arbitrary sample against any agent.
- **Interim fix applied:** handler now returns `ProofVerifierError::ReputationBindingNotReady` unconditionally. `task_market::release` no longer CPIs this rail (F-2026-03 removed `record_job_outcome`). Reputation is effectively frozen pending the real fix — acceptable for M1 pre-audit because `CategoryReputation` rows remain at their defaults and the indexer summary reads zero.
- **Full fix requires:** (1) Circom circuit rebinding to commit `(agent_did, capability_bit, sample_hash, task_id)` as public outputs, (2) re-running the trusted-setup ceremony for the new VK, (3) rebinding the handler to reconstruct `(agent_did, capability_bit, sample, task_id)` from `public_inputs[..]` rather than untrusted args, (4) deploying the new VK via `register_vk` + `activate_vk` with mode gating.
- **Owner:** `zk-circuit-engineer` (circuit + setup) → `anchor-engineer` (handler). User-gated for the trusted-setup ceremony per SAEP autonomy rules.
- **Unblocks when:** new VK is live + handler public-input parser lands + integration test proves the rail end-to-end.
- **Migration note (from follow-up audit 2026-04-16):** `VerifyAndUpdateReputation` Accounts struct still uses `Box<Account<ReentrancyGuard>>` for `caller_guard`. When re-enabling, migrate to `UncheckedAccount` + `load_caller_guard` (the F-2026-04 pattern) or Anchor deserialize will silent-fail every CPI.

## 2026-04-16 — retro_rollup + reputation_rollup upstream gaps (autonomous limit)

- **retro_rollup**: `services/indexer/src/jobs/retro_rollup.rs` returns `RollupStatus::NotYetWired` pending `fee_collector` event emission. Current `task_market::TaskReleased` carries `protocol_fee` + `solrep_fee` but no operator/agent_did attribution. Retro rollup aggregates at operator level → needs enriched event (add `operator: Pubkey` and `agent_did: [u8;32]` to TaskReleased, or new FeeAccrued event on fee_collector). Anchor-engineer work; not devnet-SOL blocked.
- **reputation_rollup**: `services/indexer/src/jobs/reputation_rollup.rs:148` TODO — IACP heartbeat ingestion into `heartbeat_presence`. No `heartbeat_presence` table migration, no IACP heartbeat publisher in `services/iacp/src/`. Requires: (1) IACP schema addition for heartbeat messages, (2) indexer migration for heartbeat_presence table, (3) IACP → indexer subscriber wiring. Cross-service design, not strictly anchor-dependent.
- **F-2026-02 proof_verifier rep binding** (above): reputation flow end-to-end blocked pending Circom rebinding + trusted-setup ceremony. Deferred per CLAUDE.md autonomy rules.
- **Current autonomous ceiling**: portal UI (done via retro/check), spec drafting, and scaffolding. Further indexer/program wiring requires anchor-engineer delegation on fee_collector events or IACP schema extension.

## 2026-04-17 — Session status update

- **Fuzz harnesses**: all 9/9 programs now have proptest-based fuzz coverage (nxs_staking was last gap — added 7 fuzz tests for StakingConfig/ReentrancyGuard/AllowedCallers)
- **SPL Token compat**: 5/5 bankrun integration tests passing with legacy `TokenkegQfe...` program — full commit-reveal + bond refund lifecycle verified
- **Security scan**: zero findings across all programs (UncheckedAccount docs ✓, no unwrap in prod ✓, numeric casts safe ✓, authority checks ✓, reentrancy guards ✓)
- **MCP bridge tools**: all 6 wired to SDK (was previously thought to be stubbed — confirmed wired with `taskMarketProgram()`, `agentRegistryProgram()`, etc.)
- **NOT_YET_WIRED remaining**: only compute-broker (io.net/Akash) — explicitly M2 scope per backlog
- **Devnet deploy**: 4/9 programs deployed (governance_program, capability_registry, nxs_staking, dispute_arbitration). Remaining 5 (fee_collector, proof_verifier, agent_registry, treasury_standard, task_market) blocked on devnet SOL — faucet rate-limited (1 SOL/project/day via Helius). Current balance: 1.28 SOL. Need ~40 SOL total for remaining programs. Will retry airdrop next session.
- **RLUSD**: blocked — Ripple hasn't deployed SPL mint on Solana
- **377 Rust tests green**, 5 SPL compat bankrun tests green

## 2026-04-16 — F-2026-12 caller_program derivation from instructions sysvar — CLOSED 2026-04-16

- **What:** `agent_registry::reputation.rs:83-87` and `proof_verifier::verify_proof.rs:57-61` derived `caller_program` via `load_instruction_at_checked(current_index - 1)` against the instructions sysvar. That loads the **previous top-level tx instruction**, not the CPI caller.
- **Fix applied:** both handlers now enforce `require!(stack_height <= 2, CpiDepthExceeded)` and derive `caller_program = current_ix.program_id` unconditionally. For SAEP's single-level CPI design this is the correct immediate caller. Deeper CPI chains are rejected up-front. `cargo test -p agent_registry -p proof_verifier` green (58+26 passed).
- **Remaining:** if multi-level CPI is ever needed (e.g. task_market → proof_verifier → agent_registry chain), the sysvar alone cannot identify the immediate caller — a distinct caller-attestation mechanism (e.g. signer PDA seeded on caller id) must be added. Not needed for M1.
