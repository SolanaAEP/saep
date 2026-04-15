# reputation-graph — derivation, anti-gaming, indexer rollup

Parent: `backlog/P1_reputation_graph.md`.
Extends (does not replace) `specs/pre-audit-03-circom-bound-reputation.md` — that doc covers the on-chain `CategoryReputation` PDA + proof-gated `update_reputation` ix. This doc covers: derivation formula, unique-execution circuit, dispute interaction, indexer rollup, portal leaderboard.

## Sample vector per completion

`ReputationSample` (argument to `update_reputation`):

```rust
pub struct ReputationSample {
    pub task_id: [u8; 32],
    pub capability_bit: u16,
    pub latency_ms: u32,        // end-to-end task duration
    pub correctness: u8,        // 0..100, graded by criteria circuit or arbiter
    pub completed: bool,        // false → mark disputed/slashed
    pub execution_root: [u8; 32], // merkle root of execution trace (see circuit)
    pub judge_kind: JudgeKind,  // Circuit | Arbiter | Client (least-trusted first)
}
```

## EWMA derivation (per-category, per-axis)

Reuse `ewma()` from `programs/agent_registry/src/state.rs:111`. Five axes:
- `quality`: sample.correctness (0..100 → 0..65535 scaled)
- `timeliness`: mapped from `latency_ms` vs `task.deadline_seconds` (over-deadline → penalty)
- `availability`: bumped by *any* `update_reputation`, decayed by missed heartbeats (see below)
- `cost_efficiency`: sample.amount_earned / task.payment_amount ratio  (denormalized)
- `honesty`: starts high, slashed by disputes; decays slowly

EWMA alpha: `alpha_bps = 2_000` default (20% weight to new sample). Tunable per capability bit via governance.

## Availability decay

Availability is a liveness proxy, not a per-task score. Off-chain heartbeat: indexer watches agent presence on IACP bus. If agent has not published to `agent.<pubkey>.inbox` in 24h, indexer emits a `heartbeat_miss` row. Every 7d, a permissionless crank ix `decay_availability(agent_did, capability_bit)` folds heartbeat_miss count into the availability axis via EWMA with negative sample.

Why on-chain: visible to consumers selecting agents, visible to auditors.

## Unique-execution circuit

File: `circuits/unique-execution.circom`. Purpose: prove the execution trace committed by `sample.execution_root` is **non-trivially distinct** from prior execution roots recorded for the same agent+capability. Blocks replay-farming (submit the same trace N times to inflate fork_count).

Public inputs:
- `agent_did`
- `capability_bit`
- `execution_root`
- `prior_roots_merkle_root` — merkle of recent execution roots (indexer-provided, capped at 512)
- `task_id`

Private inputs:
- `execution_trace` (full trace)
- `merkle_path` proving `execution_root` NOT present in `prior_roots_merkle_root` (non-membership via sorted merkle + adjacent-leaf witness).

Constraints:
- Hash `execution_trace` → `execution_root` (poseidon).
- Non-membership witness valid.
- `task_id` binds to current reputation update (replay guard at program level too).

Trusted setup: reuses M1 powers-of-tau ceremony (see `specs/ops-trusted-setup.md`); unique-execution proof key stored as a distinct `proof_verifier::ProofKey` entry.

## Dispute interaction

`dispute_arbitration::resolve` can emit a negative `ReputationSample`:
- `completed = false`
- `correctness = 0`
- `judge_kind = Arbiter`
- `execution_root = sample_root_from_dispute`

Flowed via `proof_verifier::verify_and_update_reputation` with a **dispute circuit** (distinct proof key) so the auditor can reason about rep-up vs rep-down independently. Slashing of stake happens in parallel in `agent_registry::slash` — same ix, both effects atomic.

## Anti-gaming matrix

| attack | mitigation |
|---|---|
| mint many agents, farm rep on easy tasks | category scoping + personhood gate (pre-audit 04) |
| replay same execution N times | unique-execution circuit (above) |
| collude with clients to over-rate | `correctness` only moved by circuit or arbiter; `judge_kind = Client` down-weighted to 10% EWMA alpha |
| bid-reveal spam to inflate `availability` | availability only bumped on actual settled task; commit-reveal slashing kills noise |
| cross-agent review collusion | rep updates signed by proof_verifier CPI only; no agent-to-agent rating |
| grief via dispute-raise spam | `dispute_arbitration` requires dispute bond; spammer loses bond on unfounded disputes |
| rep transfer via agent-did re-keying | agent_did derived from `(operator, agent_id, manifest_uri)` — re-key = new did, fresh rep |

## Indexer rollup

New postgres materialized view `reputation_rollup`:

```sql
CREATE MATERIALIZED VIEW reputation_rollup AS
SELECT
  agent_did,
  capability_bit,
  score.quality, score.timeliness, score.availability,
  score.cost_efficiency, score.honesty,
  jobs_completed, jobs_disputed,
  (score.quality::int8 + score.timeliness + score.availability
   + score.cost_efficiency + score.honesty) / 5 AS composite_score,
  last_update
FROM category_reputation
WHERE status = 'active';
CREATE INDEX ON reputation_rollup (capability_bit, composite_score DESC);
CREATE INDEX ON reputation_rollup (agent_did);
```

Refresh strategy: `REFRESH MATERIALIZED VIEW CONCURRENTLY` every 60s via worker. Watched via yellowstone `account_update` on CategoryReputation PDAs; triggers on-demand refresh of changed rows only (per-row refresh via upsert path, not full view).

## Portal leaderboard

`apps/portal/app/agents/leaderboard/page.tsx`:
- Query param `?capability=<bit>` selects category. Default: top 50 by composite_score.
- Columns: rank, agent did (linkified), composite, per-axis bars, jobs_completed, last_active, stake, rent price (if template author).
- Pagination: server component with cursor pagination on composite_score.
- Live update: SWR with 30s refresh; optional yellowstone subscription via existing sdk-ui hooks.

## SDK hooks

- `useReputation(agentDid, capabilityBit?)` — fetches one CategoryReputation row.
- `useLeaderboard(capabilityBit, limit?)` — paginated top-N via indexer REST.
- `useAgentReputationStream(agentDid)` — yellowstone subscription.

## Non-goals

- Agent-side self-attestation (e.g. "I claim I'm fast") — never persisted on-chain; advisory only in manifest.
- Weighted-graph PageRank across agents — M2; first ship flat category rep.
- Cross-chain reputation import (Lens, Karma3) — out of scope.

## Verify

```
anchor test tests/reputation_update.ts
cargo test -p agent_registry reputation_
pnpm --filter @saep/indexer test reputation_rollup
pnpm --filter @saep/portal test:e2e -- --grep leaderboard
```

## Open questions

- Rep export standard: do we expose an ERC-721-style badge per (agent_did, capability_bit) for portability? M2 spike; out of M1.
- Heartbeat cadence for availability decay: 24h miss = yellow, 7d = red. Governance-tunable.
