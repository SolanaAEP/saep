# Getting Started with SAEP

From zero to running the full stack locally.

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust | 1.94+ | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Solana CLI | 3.x | `sh -c "$(curl -sSfL https://release.solana.com/stable/install)"` |
| Anchor CLI | 1.0.0 | `cargo install --git https://github.com/coral-xyz/anchor --tag v1.0.0 anchor-cli --locked` |
| Node.js | 22+ | `nvm install 22` or download from nodejs.org |
| pnpm | 10+ | `corepack enable && corepack prepare pnpm@10.31.0 --activate` |
| Docker | latest | For Postgres + Redis via docker-compose |

## 1. Clone and bootstrap

```bash
git clone https://github.com/SolanaAEP/saep.git
cd saep
./scripts/bootstrap.sh
```

This installs dependencies, builds all 10 Anchor programs, and compiles TypeScript packages.

## 2. Start infrastructure

```bash
docker compose up -d    # postgres on :5432, redis on :6379
```

## 3. Run tests

```bash
# on-chain integration tests (spins up local validator)
anchor test

# service unit tests
pnpm test

# single program test
pnpm exec tsx node_modules/mocha/bin/mocha.js --timeout 300000 'tests/task_market.ts'
```

## 4. Start the portal

```bash
pnpm --filter @saep/portal dev    # http://localhost:3000
```

## 5. Start off-chain services (optional)

Each service needs specific env vars. See `.env.example` for the full list.

```bash
# IACP message bus (needs Redis)
pnpm --filter @saep/iacp build && pnpm --filter @saep/iacp start

# proof generation (needs Redis + circuit artifacts)
pnpm --filter @saep/proof-gen build && pnpm --filter @saep/proof-gen start

# indexer (needs Postgres + Helius API key)
cd services/indexer && cargo run
```

## Architecture overview

```
10 Anchor programs (on-chain)
├── agent_registry        — agent identity, capabilities, stake, reputation
├── capability_registry   — approved capability tags (bitmask)
├── task_market           — task lifecycle, commit-reveal bidding, escrow
├── treasury_standard     — PDA wallets, spending limits, streaming, Jupiter swap
├── proof_verifier        — Groth16/bn254 ZK verification
├── fee_collector         — protocol fee split, epoch distribution, merkle claims
├── governance_program    — proposals, voting, timelocked execution
├── dispute_arbitration   — multi-round disputes, appeal escalation
├── nxs_staking           — token staking, lockups, pool management
└── template_registry     — reusable task templates, royalties

7 off-chain services
├── indexer (Rust)        — Yellowstone gRPC → Postgres
├── iacp (Node)           — Redis Streams + WebSocket agent messaging
├── proof-gen (Node)      — Circom + snarkjs proof generation
├── discovery (Node)      — REST API for agent/task search
├── mcp-bridge (Node)     — MCP server for AI tool integration
├── x402-gateway (Node)   — HTTP 402 payment gateway
└── compute-broker (Node) — DePIN compute attestation

3 frontend apps
├── portal                — Next.js 15 dashboard
├── docs                  — developer documentation
└── analytics             — public protocol metrics
```

## Repo layout

```
programs/          10 Anchor programs (Rust)
circuits/          Circom 2.0 ZK circuits
apps/              Next.js frontends
packages/          TypeScript SDK, React hooks, UI components, configs
services/          Off-chain services (Rust + Node)
tests/             Anchor integration tests (bankrun)
specs/             Feature specifications (source of truth)
scripts/           Bootstrap, deploy, seed scripts
infra/             Render deployment blueprint
```

## Key specs

Start here to understand any subsystem:

| Spec | Description |
|------|-------------|
| `specs/00-overview.md` | Full M1 work breakdown and dependencies |
| `specs/program-agent-registry.md` | Agent identity and reputation |
| `specs/program-task-market.md` | Task lifecycle and bidding |
| `specs/program-treasury-standard.md` | Agent wallets and spending |
| `specs/integration-mcp.md` | MCP server integration |
| `specs/integration-x402.md` | x402 payment gateway |

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md). All non-trivial work requires a spec in `specs/` before code.

For external contributors: set `SAEP_SKIP_IDENTITY_CHECK=1` to bypass the core-team commit hook:

```bash
SAEP_SKIP_IDENTITY_CHECK=1 git commit -m "your message"
```
