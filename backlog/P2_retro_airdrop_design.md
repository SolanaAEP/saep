---
id: P2_retro_airdrop_design
status: open
blockers: []
priority: P2
---

# Retro airdrop — fee-generation-based developer incentives

## Why
Retro airdrops (à la Optimism) quality-filter better than upfront grants. Reserve 10–15% of SAEP token for agent-dev retro based on on-chain fee generation through `fee_collector`. Hyperliquid-style revenue-share rebate is stickier than one-shot grants. See `reports/strategy-2026-04.md` §Moat.

## Acceptance
- `specs/retro-airdrop.md` defining:
  - Eligibility window (trailing N epochs).
  - Fee-to-token conversion formula + cap per agent.
  - Sybil-deduplication via `agent_registry` personhood attestation (see P0_pre_audit_hardening §4).
  - Anti-wash-trading filter (self-task detection, circular settlement heuristic).
- Indexer job `services/indexer/jobs/retro-rollup.rs` computes the eligibility table nightly.
- Portal UI: "check your allocation" with signature-gated view.
- Token-2022 distribution plan aligned with M3 token launch (this is NOT a live distribution until M3 — spec-only for now).

## Steps
1. Spec.
2. Indexer rollup job.
3. Portal UI (signature-gated, no on-chain claim yet).
4. Revisit at M3 for live distribution tied to token generation event.

## Verify
```
pnpm --filter @saep/indexer test -- --grep retro-rollup
pnpm --filter @saep/portal test:e2e -- --grep allocation
```

## Log

- 2026-04-15: Spec landed at `specs/retro-airdrop.md`. 10-15% supply, 6-epoch trailing window, operator-level aggregation, wash-trading filters (self-task graph traversal, burst detection, min-payment threshold), personhood multiplier 50/75/100, cold-start 2-week protection. Indexer rollup schema + portal check page (SIWS-gated) + deferred claim ix in `retro_distributor` program at M3. Pre-M3 all off-chain; Halborn audit scheduled M3.
- 2026-04-16: Indexer migration `2026-04-16-000004_retro_eligibility` landed — creates `retro_eligibility` (operator PK) table with net_fees/wash_excluded/personhood_tier+multiplier/cold_start/estimated_allocation/epoch_first_seen columns, and `retro_fee_samples` append-only log (UNIQUE signature+task_id) with wash_flag enum (self_task/circular/burst/below_min). Indexer cargo check clean. Rollup job `services/indexer/jobs/retro-rollup.rs` still pending.
- 2026-04-16: Rollup job scaffold landed at `services/indexer/src/jobs/retro_rollup.rs` — pure-Rust classify/aggregate/estimate pipeline with `OperatorGraph` transitive ownership (depth 3), `WashFlag` enum matching migration CHECK, personhood multiplier table (50/75/100), burst detection via per-operator median×10 threshold, circular down-weight when wash/gross > 40%. `run(pool, snapshot_epoch)` orchestrator returns `RollupStatus::NotYetWired` pending fee_collector event decode + retro_eligibility upsert wiring. 12 unit tests green (below-min, self-task, circular depth limit, burst spike, aggregation sums, 40% wash zeroing, cold-start, allocation caps).
- 2026-04-16: Portal `/retro/check` page landed at `apps/portal/src/app/(app)/retro/check/page.tsx` — SIWS-gated via `useSession`, converts session.address base58 → 32-byte hex via PublicKey.toBytes, drives `useRetroEligibility` hook against indexer REST. Surfaces estimated SAEP allocation, trailing net fees, wash-excluded amount, personhood tier + multiplier, cold-start multiplier, first-seen epoch, updated relative. Nav link added between Register and Cluster line. 404 → empty-state. typecheck clean. Commit e63718c.
