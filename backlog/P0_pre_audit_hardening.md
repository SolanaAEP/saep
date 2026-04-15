---
id: P0_pre_audit_hardening
status: open
blockers: []
priority: P0
---

# Pre-audit hardening — mitigations auditors verify but don't design

## Why
Audits catch program bugs. They don't design defenses. Seven attack surfaces compound in the SAEP design and must land in program logic BEFORE M1 audit (OtterSec). Skipping these means paying for three expensive re-audits. See `reports/strategy-2026-04.md` §"Risks audits won't catch".

## Acceptance (one sub-spec per item, shipped incrementally)

Each sub-item below gets its own `specs/pre-audit-<slug>.md` with PDA/ix/invariant detail, then its own program PR. Parent ticket is done when all seven land and `reports/pre-audit-checklist.md` reports all-green.

### 1. Typed task schema + outbound whitelist (prompt-injection)
- `task_market::Task` carries a fixed-layout `TaskPayload` (enum discriminant + typed fields), not a free-form `Vec<u8>` description.
- `treasury_standard::TreasuryConfig` gains `allowed_call_targets: Vec<Pubkey>` (capped, e.g. 32). All outbound CPIs from a treasury check `contains(target)`.

### 2. Commit-reveal bidding (auction exploits + Sybil griefing)
- `task_market::Bid` splits into `commit_bid(hash, bond)` + `reveal_bid(amount, nonce)` with a window gap.
- Bond slashed on reveal-miss, returned otherwise. Stake-weighted reveal ordering for tie-break.

### 3. Circom-bound reputation updates (Sybil on rep)
- `agent_registry::reputation` mutations only via `update_reputation(proof)` CPI from `proof_verifier`. No admin-direct set.
- Reputation keyed by `(agent_did, capability_bit_index)` — category-scoped, not global scalar.

### 4. Proof-of-personhood gate (Sybil at entry)
- New `agent_registry::PersonhoodAttestation` PDA signed by Civic or Solana Attestation Service (pick one in spec phase).
- High-tier task categories require `attestation.is_some()` at bid time. Enforced in `task_market::commit_bid`.

### 5. Token-2022 TransferHook whitelist (hook exploits)
- `fee_collector::Config.allowed_hook_programs: Vec<Pubkey>` + `treasury_standard::TreasuryConfig.allowed_hook_programs`.
- On `transfer_checked_with_hook`, assert the mint's hook program is in the whitelist. Reject unknown hooks.

### 6. Jito bundle settlement (MEV)
- Integration, not on-chain: `services/indexer` / settlement worker submits `task_market::settle` via Jito block-engine with priority fee, not plain RPC.
- Spec the settlement policy under `specs/mev-settlement.md`. On-chain change: none required if bundle is compositional.

### 7. CPI depth + reentrancy guards (cross-program reentrancy)
- All state-changing ix that CPI into another SAEP program set a `guard: bool` in their config PDA at entry, clear at exit. CPI callees assert the caller's guard is set.
- CPI depth hard-capped: `task_market` → `treasury_standard` → `fee_collector` is the only chain; no callee CPIs back up.
- Write invariants as `#[cfg(test)]` unit assertions per program before audit.

## Steps
1. Write `specs/pre-audit-<slug>.md` (7 specs — short, spec-PDF-aligned).
2. Delegate implementation to `anchor-engineer` teammate per-spec, in priority order (1 → 7 above).
3. Each PR blocked on `solana-security-auditor` internal pass.
4. After all seven: `reports/pre-audit-checklist.md` green-light + enter M1 audit queue.

## Verify
```
anchor build
anchor test  # all programs green, all new invariants covered
cargo test -p task_market -p treasury_standard -p agent_registry -p fee_collector -p proof_verifier
```

## Log
