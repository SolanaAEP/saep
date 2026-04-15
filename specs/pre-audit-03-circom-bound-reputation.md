# Pre-audit 03 — circom-bound reputation + category-scoped scoring

Parent: `backlog/P0_pre_audit_hardening.md` item 3.
Threat: admin-set or off-chain-set reputation lets the protocol authority (or a compromised indexer) lie. Single-scalar rep lets an agent farm one easy category to win high-stakes tasks in another.

## Current state

`programs/agent_registry/src/state.rs:36` has `ReputationScore` embedded in `AgentAccount` — a flat 6-axis EWMA with no proof binding. Updates flow from whichever ix mutates the agent. Needs to be gated behind a proof_verifier CPI and exploded to per-capability-bit.

## On-chain redesign

### New account: `CategoryReputation`

```rust
pub const CATEGORY_REP_VERSION: u8 = 1;

#[account]
#[derive(InitSpace)]
pub struct CategoryReputation {
    pub agent_did: [u8; 32],
    pub capability_bit: u16,          // 0..127, indexes into capability_mask
    pub score: ReputationScore,       // existing struct, reused
    pub jobs_completed: u32,
    pub jobs_disputed: u16,
    pub last_proof_key: [u8; 32],     // proof_verifier verification key used
    pub last_task_id: [u8; 32],
    pub version: u8,
    pub bump: u8,
}
```

PDA: `[b"rep", agent_did, capability_bit.to_le_bytes()]`.

`AgentAccount.reputation` becomes a rolled-up aggregate (read-only summary) computed from category rows by the indexer, cached on-chain every N updates via `snapshot_reputation` (optimization, not required for M1).

### New ix `update_reputation`

- Signer: **only proof_verifier program** (via CPI). Checked by:
  ```rust
  require_keys_eq!(
      ctx.accounts.invoker.key(),
      registry_global.proof_verifier,
      AgentRegistryError::UnauthorizedReputationUpdate
  );
  ```
  No admin path. No operator path. Direct authority mutation of `score` fields is removed.
- Args: `agent_did, capability_bit, sample: ReputationSample, task_id, proof_key`.
- Effect: EWMA-fold the sample into the targeted `CategoryReputation`. Increment counters.

### proof_verifier plumbing

`proof_verifier::verify_and_update_reputation` (new ix) takes:
- `public_inputs: TaskCompletionPublicInputs` (from `specs/05-circuit-task-completion.md`)
- `proof: Groth16Proof`

Flow:
1. Verify Groth16 proof against registered `proof_key`.
2. Derive `(agent_did, capability_bit, sample)` from public inputs (circuit commits to task outcome vector).
3. CPI to `agent_registry::update_reputation` using proof_verifier's PDA signer.

No reputation ever mutates without a valid proof verified on-chain in the same tx.

### Removals / fences

- `authority_touch_reputation` admin ix (if any) — delete.
- `AgentAccount.reputation` becomes `#[cfg(not(feature="legacy-rep"))]` gated; new code reads from category PDAs. Pre-M1, simply remove.

## Invariants

1. Any caller other than `registry_global.proof_verifier` on `update_reputation` → `UnauthorizedReputationUpdate`.
2. `capability_bit >= 128` → `InvalidCapability`.
3. `capability_bit` not set in agent's `capability_mask` → `InvalidCapability` (no farming categories you didn't declare).
4. Same `task_id` replay → `ReputationReplay` (store `last_task_id` per category; reject equal).
5. Dispute resolution can invoke `update_reputation` with a negative sample only via proof_verifier (dispute proof). Same rail.
6. `CategoryReputation::jobs_disputed <= jobs_completed`.

## Events

- `CategoryReputationUpdated { agent_did, capability_bit, sample, score_snapshot, task_id }`

## Migration

Pre-M1, no live rep. Drop the old fields from `AgentAccount`. Indexer reads category rows.

## Verify

```
cargo test -p agent_registry reputation_
cargo test -p proof_verifier update_reputation_cpi
anchor test tests/reputation_proof_bound.ts
```

## Open questions

- Per-category PDA rent cost at scale (128 bits × N agents). Propose lazy init: create CategoryReputation on first sample, not at agent registration. Yes — lazy.
- Dispute negative samples via same circuit vs a distinct dispute-proof circuit. Lean: distinct circuit, different proof_key, so auditors can reason about rep-up and rep-down independently. Capture in `specs/05-circuit-task-completion.md` addendum.
