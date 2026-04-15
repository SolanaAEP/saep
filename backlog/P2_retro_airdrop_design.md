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
