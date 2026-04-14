# Report 01 — Monorepo Bootstrap

**Spec:** `specs/01-repo-monorepo-bootstrap.md`
**Status:** complete
**Date:** 2026-04-14

## What exists

### Root
- `package.json` — pnpm workspace, turbo, typescript, mocha/chai/ts-mocha for anchor tests
- `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.nvmrc` (node 24)
- `Cargo.toml` — rust workspace covering the 7 anchor programs
- `Anchor.toml` — localnet program IDs wired, test runner uses legacy `solana-test-validator` with `bind_address = 127.0.0.1` (fixes agave 3.0.x gossip panic under anchor default surfpool which isn't installed)
- `.gitignore`, `.env.example`, `.prettierrc`, `eslint.config.js`, `.npmrc`

### Programs (anchor workspace, 7 stubs)
Each in `programs/<name>/` with its own `Cargo.toml` and `src/lib.rs` containing a single empty `initialize` handler. Deploy keypairs live in `target/deploy/*-keypair.json` (gitignored).

| Program | Program ID |
|---|---|
| agent_registry | `EQJ4Lp2gxJDD5hs185aDcermYWdAi4cQeSKfnuqLAQYu` |
| treasury_standard | `6boJQg4L6FRS7YZ5rFXfKUaXSy3eCKnW2SdrT3LJLizQ` |
| task_market | `HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w` |
| dispute_arbitration | `GM8xiT17USBpCW24XXBmUR8YVCxxrJPMEcsddwfUokMa` |
| governance_program | `9uczLDZaN9EWqW76be75ji4vCsz3cydefbChqvBS6qw1` |
| fee_collector | `4xLpFgjpZwJbf61UyvyMhmEBmeJzPaCyKvZeYuK2YFFu` |
| proof_verifier | `DcJx1p6bcNuFm4i5WMgK4uGZitc1bf4Ubc5d4sctZKVe` |

Anchor build emits 7 `.so` binaries + 7 IDL JSON files into `target/`. Program IDs are also exported from `packages/sdk/src/index.ts`.

### Apps
- `apps/portal` — Next.js 15.1.6 + React 19 + Tailwind 4.1. Renders `<h1>SAEP</h1>` on `/` plus a client-side-only `WalletMultiButton` (phantom + solflare adapters wired). Providers in `src/app/providers.tsx`.
- `apps/docs` — Next.js 15 stub, `<h1>SAEP Docs</h1>`, port 3001
- `apps/analytics` — Next.js 15 stub, `<h1>SAEP Analytics</h1>`, port 3002

### Packages
- `@saep/sdk` — TS package, currently exports `SAEP_PROGRAM_IDS` constants. IDL-generated clients land here later.
- `@saep/sdk-ui` — stub `useProgramIds()` hook, will grow into the wallet/program hook surface
- `@saep/ui` — stub `<Button>`, placeholder for the shadcn component library
- `@saep/config` — shared configs (tailwind, eslint, tsconfig base)

### Services
- `services/indexer` — standalone rust crate (not in anchor workspace), tokio + tracing stub. `cargo check` clean.
- `services/proof-gen` — node/TS stub, tsc build clean. NestJS scaffold deferred to its own spec.
- `services/iacp` — node/TS stub, tsc build clean.

### Other
- `circuits/README.md` — placeholder
- `infra/render.yaml` — render blueprint for iacp/proof-gen/indexer
- `wallets/README.md` — gitignored directory for local keypairs
- `scripts/bootstrap.sh` — one-shot install + build
- `.github/workflows/ci.yml` — pnpm build/typecheck/lint + cargo clippy + anchor build
- `.github/workflows/security-scan.yml` — weekly cargo-audit + pnpm audit + semgrep

## How to run

```bash
# one-shot bootstrap (installs deps, builds everything)
./scripts/bootstrap.sh

# anchor
anchor build                          # produces 7 stub program binaries
anchor test --validator legacy        # runs ts-mocha smoke test against localnet

# workspaces
pnpm install
pnpm -r build

# portal dev server
pnpm --filter @saep/portal dev        # http://localhost:3000
pnpm --filter @saep/docs dev          # http://localhost:3001
pnpm --filter @saep/analytics dev     # http://localhost:3002
```

## Acceptance check

- [x] `pnpm install` clean
- [x] `anchor build` produces 7 program binaries
- [x] `anchor test --validator legacy` passes (1 passing smoke test)
- [x] `pnpm -r build` succeeds for all 9 workspace packages
- [x] `apps/portal` dev server renders "SAEP" with WalletMultiButton visible
- [x] First commit on `main`, ready to push

## Stack pins (locked)

| Tool | Version |
|---|---|
| solana-cli | 3.0.13 |
| anchor-cli | 1.0.0 |
| anchor-lang (crate) | 1.0.0 |
| node | 24 (nvmrc) |
| pnpm | 10.31.0 |
| next | 15.1.6 |
| react / react-dom | 19.0.0 |
| tailwindcss | 4.1.14 |
| turbo | 2.3.3 |
| typescript | 5.7.3 |
| @solana/web3.js | 1.98.0 |
| @solana/wallet-adapter-react | 0.15.35 |

## Known stubs / deferred

1. **Anchor `test.validator = "surfpool"` default** — anchor 1.0 defaults to surfpool which isn't installed. Workaround: `anchor test --validator legacy`. Can't set the default to `legacy` in `Anchor.toml` because of a toml key collision with the `[test.validator]` section.
2. **ESLint not yet configured in apps** — `next build` warns but doesn't fail. Hardening phase adds a real `eslint.config.js` per app.
3. **proof-gen / iacp are not NestJS yet** — spec called for NestJS scaffolds but we shipped the smaller node+TS stubs so the workspace builds clean without pulling NestJS's dependency tree. When those services get real specs (IACP bus, proof service) we'll decide framework then.
4. **Indexer is a standalone cargo project** — deliberately isolated from the anchor workspace to keep sbpf-only deps separate from the indexer's host deps.
5. **CI runs `pnpm lint`** — no per-package lint scripts produce real output yet. All packages stub `lint: echo skip`.
6. **Peer-dep warnings from wallet-adapter-wallets** — pulls in an old `qrcode.react@1.0.1` and `use-sync-external-store@1.2.0` that want react ≤18. Doesn't affect runtime because wallet-adapter guards at runtime. Hardening may pin a subset of wallets to drop react-native transitive deps.
7. **`bigint: Failed to load bindings, pure JS will be used`** — benign warning from `bigint-buffer` used by web3.js; falls back to pure JS. Can silence by approving its build script in `.npmrc`.
8. **Anchor cfg warnings** — `unexpected cfg condition value: custom-heap/custom-panic/anchor-debug` appear during `anchor build` because anchor 1.0's proc-macro emits cfg flags the newer rustc doesn't know about. Upstream, harmless. Will disappear when anchor ships a patch or we move to Rust's `check-cfg` allowlist.

## Commits

```
67d4904 bootstrap: circuits placeholder, render.yaml, CI, bootstrap script
404317b bootstrap: service stubs (indexer, proof-gen, iacp)
8df77be bootstrap: next.js 15 apps (portal with wallet-adapter, docs, analytics)
47159ea bootstrap: shared packages (sdk, sdk-ui, ui, config)
04ee430 bootstrap: anchor test harness with legacy validator
05f78ce bootstrap: pnpm workspace + turbo + anchor workspace with 7 stub programs
```

Ready to push to the SAEP GitHub repo once the remote URL is confirmed.
