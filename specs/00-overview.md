# SAEP — Overview Spec

This file sequences the work into shippable specs, each of which has its own file in `specs/`.

## M1 — Alpha Devnet (target: OtterSec audit-ready)

Scope per backend §5.3: AgentRegistry + TreasuryStandard + TaskMarket + a ProofVerifier scaffold + the minimum off-chain/frontend to demo the golden path.

**Golden path for M1 demo:** An operator connects a wallet → registers an agent → funds its treasury → a client browses the marketplace → creates a task contract with escrow → agent submits a result + proof → escrow releases.

### Work breakdown (ordered by dependency)

| # | Spec file | Owner agent | Dependencies | Done = |
|---|---|---|---|---|
| 01 | `repo-monorepo-bootstrap.md` | scaffolder | — | Turborepo + Anchor workspace + pnpm + CI skeleton pushed, `anchor localnet` green |
| 02 | `program-capability-registry.md` | anchor-engineer | 01 | 32 initial capability tags seeded, governance-gated additions stubbed |
| 03 | `program-agent-registry.md` | anchor-engineer | 02 | backend §2.2 fully implemented, audit checklist clean |
| 04 | `program-treasury-standard.md` | anchor-engineer | 03 | backend §2.3: PDA wallet, spending limits, streaming, Jupiter CPI |
| 05 | `circuit-task-completion.md` | zk-circuit-engineer | 01 | Circom circuit + snarkjs end-to-end, constraint count documented |
| 06 | `program-proof-verifier.md` | anchor-engineer + zk-circuit-engineer | 05 | On-chain Groth16 verify via Light Protocol, localnet integration green |
| 07 | `program-task-market.md` | anchor-engineer | 03, 04, 06 | backend §2.4 state machine, Jito bundle atomic create+fund |
| 08 | `service-indexer.md` | solana-indexer-engineer | 03 (first program deployable) | Yellowstone→Postgres for registered programs, lag alert, <50ms p50 |
| 09 | `service-proof-gen.md` | zk-circuit-engineer | 05 | NestJS API + Bull queue, GPU worker, proof returns in <5s for test circuit |
| 10 | `frontend-portal-m1.md` | frontend-engineer | 03, 04, 07, 08 | Pages in frontend §2.1+§2.2 for M1 scope: dashboard, register, marketplace, task detail |
| 11 | `sdk-typescript.md` | frontend-engineer | 03-07 IDLs | `packages/sdk` with generated types, instruction builders, hooks in `sdk-ui` |
| 12 | `e2e-golden-path.md` | playwright-tester | 10, 11 | Full golden path green against localnet, runs in CI |
| 13 | `audit-package-m1.md` | reviewer + solana-security-auditor | all above | Audit-firm handoff: programs, tests, invariants doc, threat model, scope letter |

### Explicitly out of M1

DisputeArbitration, GovernanceProgram, FeeCollector, full IACP message bus, Token-2022 mint (still USDC/SOL only for payments in M1), confidential transfers, cross-chain, analytics app, docs app. These are M2+.

### Parallelization plan

Once 01 lands, 02–05 can run in parallel (independent programs + the circuit). 08 can start as soon as 03 is deployable to localnet. 10 and 11 start once 03/04 IDLs are stable. 09 needs 05 first.

Expect agent-team spawns at:
- After 01: spawn `anchor-engineer` × 2 (one for 02+03, one for 04) + `zk-circuit-engineer` (05) + `researcher` for any open infra questions.
- After 05: spawn `zk-circuit-engineer` (09) + `anchor-engineer` (06).
- After 07: spawn `frontend-engineer` (10+11) + `playwright-tester` (12) in parallel with a final `anchor-engineer` pass.

### Open questions (surface to the human)

1. Helius account and API keys (required for 08 and 10).
2. Render Postgres provisioned for indexer (required for 08). Not Supabase — see CLAUDE.md Hosting.
3. Vercel org for frontend deployment (required at 10 to see something in a URL, not blocking local dev).
4. Whether to use the existing clanker-monitor Solana wallet infra or create fresh SAEP keypairs.
5. Audit firm engagement timing — OtterSec booking lead time is typically 4–6 weeks, so we should initiate outreach before 07 lands, not after.
