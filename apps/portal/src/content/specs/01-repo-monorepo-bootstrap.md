# Spec 01 — Monorepo Bootstrap

**Owner:** scaffolder
**Depends on:** —
**Blocks:** everything in M1
**References:** frontend PDF §1.2, backend PDF §4.1–§4.2

## Goal

A working Turborepo monorepo containing the Anchor workspace, stub Next.js apps, shared packages, and service scaffolds. `anchor localnet` runs green against a stub program. `pnpm install` + `pnpm build` clean.

## Repo layout

```
/
├── Anchor.toml              # workspace with all 7 program paths (even if stub)
├── Cargo.toml               # workspace root
├── package.json             # pnpm workspace root
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── .gitignore
├── .env.example
├── .nvmrc                   # node 24
├── .prettierrc, eslint.config.js
├── .github/workflows/
│   ├── ci.yml               # lint, typecheck, anchor build, anchor test
│   └── security-scan.yml    # cargo-audit + semgrep (weekly)
├── programs/
│   ├── agent_registry/
│   ├── treasury_standard/
│   ├── task_market/
│   ├── dispute_arbitration/
│   ├── governance_program/
│   ├── fee_collector/
│   └── proof_verifier/
│   (each: Cargo.toml + src/lib.rs with Anchor `declare_id!` + empty handler)
├── circuits/
│   └── README.md            # Circom 2.0 target, placeholder
├── apps/
│   ├── portal/              # Next.js 15 App Router, shadcn initialised, wallet-adapter wired
│   ├── docs/                # Next.js 15 (or Nextra) stub
│   └── analytics/           # Next.js 15 stub
├── packages/
│   ├── sdk/                 # TS SDK — IDL-generated types land here
│   ├── sdk-ui/              # React hooks wrapping sdk
│   ├── ui/                  # shadcn component library
│   └── config/              # shared eslint, ts, tailwind configs
├── services/
│   ├── indexer/             # Rust crate, tokio + tonic + sqlx, main.rs stub
│   ├── proof-gen/           # NestJS stub
│   └── iacp/                # NestJS + ws stub
├── infra/
│   └── render.yaml          # Render blueprint for services
├── wallets/                 # gitignored, README only
├── scripts/
│   └── bootstrap.sh         # one-shot: install deps, build, run localnet, run tests
├── specs/                   # (already exists)
├── reports/                 # (already exists)
├── docs/                    # source-of-truth PDFs (already present)
└── .claude/                 # (already exists — agents + settings)
```

## Non-goals for this spec

- Real program logic (empty handlers are fine — each real program has its own spec)
- Real frontend pages (just Next.js 15 scaffold + wallet provider + a "SAEP" h1)
- Indexer/proof-gen/iacp beyond a `cargo check` / `nest build` clean stub
- Auth, SIWS, database connections

## Stack pins

- **Anchor**: 1.0 (newer than the PDF's 0.30+ — fully compatible; note the bump in repo README)
- **Solana CLI**: matches installed toolchain (3.0.13 as of bootstrap)
- **Node**: 24 (per installed env; `.nvmrc` locks it)
- **pnpm**: 10
- **Next.js**: 15.x, React 19.x, Tailwind 4.x
- **Turbo**: latest
- **Rust**: stable (bootstrap verifies `rustc --version`)

## CI skeleton

`.github/workflows/ci.yml` runs on every PR:
1. `pnpm install --frozen-lockfile`
2. `pnpm lint` (turbo)
3. `pnpm typecheck` (turbo)
4. `cargo clippy -- -D warnings` across the workspace
5. `anchor build`
6. `anchor test` (localnet — may skip on push, only PR)

`.github/workflows/security-scan.yml` weekly:
- `cargo audit`
- `pnpm audit`
- `semgrep --config=auto`

## Done = all of:

- [ ] `pnpm install` clean
- [ ] `anchor build` produces 7 program binaries (stubs OK)
- [ ] `anchor test` passes (empty test per program is fine)
- [ ] `pnpm -r build` succeeds for apps and packages
- [ ] `apps/portal` dev server renders "SAEP" with wallet-adapter visible
- [ ] First commit on `main`, ready to push to GitHub SAEP repo
- [ ] `reports/01-bootstrap.md` summarising what exists, how to run, known stubs
