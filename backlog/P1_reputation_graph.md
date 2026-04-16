---
id: P1_reputation_graph
status: open
blockers: []
priority: P1
---

# Reputation graph — category-scoped, proof-bound, Sybil-resistant

## Why
Reputation is SAEP's strongest real moat: the historical performance corpus is unforkable even if code is copied. Global scores are Sybil-trivial; global Sybil-resistance hacks (stake gating only) raise bar but don't close it. Category scoping + Circom-bound updates + optional personhood gate = defense in depth. This ticket is *also* risk mitigation #3 in `P0_pre_audit_hardening.md` — execute together.

## Acceptance
- `agent_registry::reputation` is keyed `(agent_did, capability_bit_index) → ReputationScore`, not a scalar per agent.
- `ReputationScore { completed, disputed, slashed, ema_latency_ms }` updated only via CPI from `proof_verifier::attest_completion(proof)`. No admin setter.
- Circom circuit variant `circuits/unique-execution.circom` proves execution trace uniqueness (prevents replay farming). Spec first; circuit engineer implements.
- Portal leaderboard per capability: consumer can browse "top agents for capability `code_gen`" with live updates.
- Indexer materializes `reputation_rollup` view for fast queries.

## Steps
1. `specs/reputation-graph.md` — derivation formula, anti-gaming proofs, interaction with `dispute_arbitration` slashing.
2. `zk-circuit-engineer` spec for unique-execution circuit.
3. `anchor-engineer` patches `agent_registry` + `proof_verifier` integration.
4. `solana-indexer-engineer` adds rollup materialization.
5. `frontend-engineer` builds leaderboard UI.

## Verify
```
anchor test
pnpm --filter @saep/indexer test
pnpm --filter @saep/portal test:e2e -- --grep reputation
```

## Log

- 2026-04-15: Spec landed at `specs/reputation-graph.md`. Builds on pre-audit 03 on-chain surface; adds EWMA derivation per axis, unique-execution circuit public/private inputs + non-membership witness, dispute→negative-sample via distinct proof key, availability decay via indexer heartbeat + `decay_availability` crank, postgres `reputation_rollup` materialized view + portal leaderboard surface + sdk hooks (useReputation/useLeaderboard/useAgentReputationStream). Implementation pending zk-circuit-engineer + anchor-engineer + solana-indexer-engineer delegation.
- 2026-04-16: Indexer migration `2026-04-16-000003_reputation_rollup` landed — creates `category_reputation` (agent_did, capability_bit) composite PK with 5 EWMA axes + jobs_completed/disputed + status, `reputation_samples` append-only event log (judge_kind enum, execution_root, UNIQUE on signature+task+did+bit for replay idempotency), and `reputation_rollup` materialized view with composite_score + leaderboard index. Unique PK index on rollup enables `REFRESH MATERIALIZED VIEW CONCURRENTLY`. Indexer cargo check clean.
- 2026-04-16: Rollup refresh worker landed at `services/indexer/src/jobs/reputation_rollup.rs` — `refresh_rollup()` drives `REFRESH MATERIALIZED VIEW CONCURRENTLY reputation_rollup` via `spawn_blocking`, and pure availability-projection helpers (`ewma_u16` byte-for-byte match to `agent_registry::state::ewma`, `count_misses` with 24h-window + 7d clip, `project_availability` compounds zero-samples through EWMA, `project_batch` per (agent_did, capability_bit)). 9 unit tests green. TODO markers for IACP heartbeat ingestion into `heartbeat_presence` + preview-row writeback pending IACP→indexer wiring.
- 2026-04-16: REST surface landed at `services/indexer/src/api.rs` — `GET /leaderboard?capability=<bit>&limit&cursor` (cursor = composite_score for keyset pagination), `GET /agents/:did/reputation` (per-capability rows), `GET /retro/eligibility/:operator`. Queries use raw `sql_query` against the materialized view (schema.rs only tracks legacy event tables). Hex-encoded pubkey IO, `tokio::spawn_blocking` around diesel, typed `ApiError` → JSON problem-responses. Merged into the existing axum router alongside /healthz + /metrics.
- 2026-04-16: SDK-UI hooks landed at `packages/sdk-ui/src/hooks/reputation.ts` — `useLeaderboard({ indexerUrl, capabilityBit, limit, cursor })`, `useAgentReputation({ indexerUrl, agentDidHex })`, `useRetroEligibility({ indexerUrl, operatorHex })` wrapping the indexer REST routes. camelCase/snake_case mapping at the boundary, 30s/60s staleTime, 404 → `null` on retro lookup. Exported from sdk-ui index.
- 2026-04-16: Portal leaderboard page landed at `apps/portal/src/app/(app)/agents/leaderboard/page.tsx` — capability dropdown (32 CAPABILITY_LABELS), table of top 50 rows with rank, did-linkified agent column, composite score, per-axis bars (Q/T/A/C/H scaled to 65535), jobs_completed, disputes, relative last_active. Nav link added to `(app)/layout.tsx` between Marketplace and Register. Indexer URL via `NEXT_PUBLIC_INDEXER_URL` with localhost fallback. SIWS-gated retro `/retro/check` page still pending.
