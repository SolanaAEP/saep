# Contributing to SAEP

Thanks for the interest. SAEP is a protocol, not a library, and the contribution model reflects that: everything that touches on-chain state ships through a spec → implement → internal audit → external audit pipeline. Off-chain code moves faster.

## Before you start

- Read the [README](./README.md) for the architecture.
- Skim [`specs/00-overview.md`](./specs/00-overview.md) for the current milestone plan.
- Source of truth for design decisions lives in [`docs/backend-build.pdf`](./docs/backend-build.pdf) and [`docs/frontend-build.pdf`](./docs/frontend-build.pdf). Cite section numbers when relevant.

## Development setup

Prerequisites: Node 24, pnpm 10, Rust stable, Solana CLI 3.x, Anchor 1.0.

```bash
git clone git@github.com:SolanaAEP/saep.git
cd saep
./scripts/bootstrap.sh
```

What it verifies: `pnpm install` clean, `anchor build` produces 7 binaries, `anchor test --validator legacy` green, `pnpm -r build` succeeds, portal dev server renders.

## Where changes go

| Area | Workflow |
|---|---|
| `programs/` | Spec → implement → unit + integration tests → internal security audit → external audit → mainnet |
| `circuits/` | Spec → implement → external cryptographer review → trusted-setup ceremony (multi-party) |
| `services/` | Spec → implement → production hardening → reviewer |
| `apps/`, `packages/` | Spec → implement → reviewer |
| `specs/`, `docs/` | PR with clear rationale; no audit required |

On-chain code is **never** the place for "we'll harden it later." Security is a gate, not a follow-up.

## Spec-first for anything non-trivial

Before writing code for a new program, circuit, service, or page, open a PR that adds `specs/<feature>.md`. The spec should include:

- Goal and scope
- For programs: PDAs (seeds + fields), instructions (signatures + validation + CPI deps), events, errors, CU budget, invariants
- For circuits: constraint budget, public input ordering, trusted-setup plan
- For services: dependencies, data flow, failure modes, deployment target
- For UI: page contracts, wallet flows, data sources
- Done criteria — a concrete checklist a reviewer can verify

Merge the spec before merging implementation. This saves time for everyone.

## Code style

- Rust: `cargo fmt` + `cargo clippy -- -D warnings`. No `unwrap`/`expect` in program code; return typed errors.
- TypeScript: Prettier + the shared ESLint config in `packages/config`. Prefer functional `@solana/web3.js` v2 APIs over the legacy class-based ones for new code.
- Match existing patterns before introducing new ones.
- No dead code, no placeholder TODOs, no boilerplate comments.

## Commits

Terse, lowercase, imperative mood. Reference the spec you're implementing.

```
program-agent-registry: add slash timelock with 30d queue
```

Use the distributed identity helper for attribution:

```bash
scripts/commit-as.sh -- -m "your message"   # round-robin
scripts/commit-as.sh hl -- -m "your message"  # pin to a contributor
```

The local git config has `user.email` and `user.name` unset deliberately — bare `git commit` will fail rather than silently pick one identity.

## Pull requests

- One spec per PR. Don't bundle unrelated work.
- Fill out the PR template. Skipping the audit checklist for on-chain changes blocks merge.
- CI must be green: lint, typecheck, clippy, anchor build, anchor test.
- For `programs/` changes: note the CU budget delta and any new CPI dependencies.
- For `circuits/` changes: note the constraint count delta.

Reviewers look for: spec compliance, test coverage for the happy path and the documented failure modes, and that no existing invariant from `specs/` was silently broken.

## Reporting bugs

- **Security-sensitive:** follow [SECURITY.md](./SECURITY.md). Do not open public issues.
- **Everything else:** use the issue templates. Include the commit hash and, for program bugs, a failing test or transaction signature.

## Code of conduct

All participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md). In short: be decent; technical disagreement is welcome, personal attacks are not.

## License

By contributing, you agree your contributions will be licensed under the [Apache License 2.0](./LICENSE). The patent grant is important for a protocol — don't contribute if you can't grant it.
