---
id: P1_agent_template_registry
status: open
blockers: []
priority: P1
---

# Agent template registry — the Upwork → Airbnb pivot

## Why
SAEP's task/bidding frame is 2023-shaped. 2026 winners ship agent *templates* you rent/clone (Virtuals, Wayfinder) rather than RFQ flows. This is the single highest-leverage product pivot. Adds a layer above `agent_registry` for template fork/clone/royalty. See `reports/strategy-2026-04.md` §Differentiation.

## Acceptance
- New program `template_registry` (or a module extension to `agent_registry` — spec decides) with:
  - `AgentTemplate` PDA: `{author, config_hash, royalty_bps, fork_count, total_revenue}`.
  - `mint_template(config)` — author publishes a template.
  - `fork_template(parent)` — operator clones; stores `parent_template` pointer + flows royalty_bps of treasury revenue back to author.
  - `rent_template(template, duration, rent_amount)` — consumer leases a prebuilt agent (different from fork: no new agent PDA, shared compute).
- `treasury_standard` respects royalty splits on settlement.
- Consumer surface in `apps/portal`: "rent this agent for $X/month" one-click flow.
- SDK + SDK-UI hooks: `useTemplate(id)`, `useForkTemplate()`, `useRentTemplate()`.

## Steps
1. `specs/program-template-registry.md` from backend PDF patterns.
2. `anchor-engineer` builds program + unit + integration tests.
3. `frontend-engineer` builds rental UI in portal.
4. `solana-security-auditor` round — royalty flows are value-at-risk, treat as audit-gated like escrow.
5. SDK regeneration (blocks on P1_sdk_typescript_generation).

## Verify
```
anchor build
anchor test
pnpm --filter @saep/portal test:e2e -- --grep rent
```

## Log

- 2026-04-15: Spec landed at `specs/program-template-registry.md` — AgentTemplate/TemplateFork/TemplateRental PDAs, fork lineage cap 8, royalty snapshot at fork time, rental drip math, settle_royalty_cpi gated to treasury_standard PDA caller. CPI-graph edges extend pre-audit 07 DAG; no back-edges. Frontend + SDK-UI hook surface enumerated. Implementation pending anchor-engineer delegation; ticket stays open.
