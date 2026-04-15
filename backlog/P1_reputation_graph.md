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
