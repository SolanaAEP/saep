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

Production portal deployments now target the mainnet task market. Set `NEXT_PUBLIC_SOLANA_CLUSTER`
to `mainnet-beta`, provide a Helius-backed `NEXT_PUBLIC_RPC_URL`, and pin the mainnet program IDs
from the release environment. The legacy `/api/actions/create-task` route remains devnet-only
because mainnet public tasks must create and fund escrow atomically through wallet-signed Quick Hire.

Production env baseline:

```bash
NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta
NEXT_PUBLIC_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<helius-key>
NEXT_PUBLIC_PROGRAM_AGENT_REGISTRY=EQJ4Lp2gxJDD5hs185aDcermYWdAi4cQeSKfnuqLAQYu
NEXT_PUBLIC_PROGRAM_CAPABILITY_REGISTRY=GW161Wce7z4S2rdcSCPNGixn2YQajefNc4r3jUj9zZ5F
NEXT_PUBLIC_PROGRAM_TREASURY_STANDARD=6boJQg4L6FRS7YZ5rFXfKUaXSy3eCKnW2SdrT3LJLizQ
NEXT_PUBLIC_PROGRAM_TASK_MARKET=HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w
NEXT_PUBLIC_PROGRAM_PROOF_VERIFIER=DcJx1p6bcNuFm4i5WMgK4uGZitc1bf4Ubc5d4sctZKVe
NEXT_PUBLIC_DEFAULT_PAYMENT_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
DISCOVERY_API_URL=https://saep-indexer-api.onrender.com
```

## 5. Start off-chain services (optional)

Each service needs specific env vars. See `.env.example` for the full list.

```bash
# IACP message bus (needs Redis)
pnpm --filter @saep/iacp build && pnpm --filter @saep/iacp start

# proof generation (needs Redis + circuit artifacts)
pnpm --filter @saep/proof-gen build && pnpm --filter @saep/proof-gen start

# x402 settlement edge (needs Redis + RPC + funded signer)
# add X402_RECIPIENT_OPERATOR_KEYPAIR when you want the gateway to auto-complete
# submit_result + verify_task + release for a managed recipient DID
# lower X402_TASK_DEADLINE_SECS for faster managed devnet smoke runs
pnpm --filter @saep/x402-gateway build && pnpm --filter @saep/x402-gateway start

# indexer with internal + public APIs
SOLANA_CLUSTER=mainnet INDEXER_ROLE=all INDEXER_RUN_MIGRATIONS=1 API_PORT=8081 HEALTHCHECK_PORT=8080 \
  INDEXER_INTERNAL_API_TOKEN=local-saep-indexer-token \
  cargo run --manifest-path services/indexer/Cargo.toml --bin saep-indexer

# discovery API (needs Postgres)
pnpm --filter @saep/discovery build && pnpm --filter @saep/discovery start

# compute broker with persisted snapshot sync (mock providers, no external DePIN creds)
COMPUTE_PROVIDER_MODE=mock \
  BROKER_SIGNING_KEY_HEX=abababababababababababababababababababababababababababababababab \
  INDEXER_INTERNAL_API_URL=http://127.0.0.1:8080 \
  INDEXER_INTERNAL_API_TOKEN=local-saep-indexer-token \
  COMPUTE_BOND_STORE_PATH=.local/compute-broker.json \
  pnpm --filter @saep/compute-broker build && pnpm --filter @saep/compute-broker start
```

Run those long-lived services in separate terminals if you want to exercise the persisted
compute-bond read path locally.

Hosted mainnet acceptance uses the Render indexer smoke with nonzero recent data:

```bash
pnpm smoke:indexer:render --min-latest-slot 1 --min-events-total 1
```

## 5b. Smoke-test persisted compute-bond snapshots

For the supported local smoke path, you only need Docker/Postgres available:

```bash
pnpm smoke:compute-bonds:local
```

That command boots the API-only indexer with migrations enabled, starts Discovery and the compute
broker in mock-provider mode, runs the live reserve → lock → release flow, then tears the stack
down automatically.

If you already have the services running yourself, you can still drive one full reserve → lock →
release flow and wait for both read paths to converge with:

```bash
pnpm smoke:compute-bonds
```

Useful flags:

```bash
pnpm smoke:compute-bonds --skip-release
pnpm smoke:compute-bonds --task-id <64-char-hex>
pnpm smoke:compute-bonds --provider akash --gpu-hours 8 --duration-secs 7200
```

The smoke commands expect the indexer public API on `http://127.0.0.1:8081`, the broker on
`http://127.0.0.1:8788`, and Discovery on `http://127.0.0.1:8790` unless you override them with
CLI flags or the matching `SAEP_*` or `SMOKE_*` environment variables.

## 5c. Bootstrap devnet proof verification and smoke payout release

This flow is for the live devnet proof-verifier path behind `task_market::verify_task` and
`claim_payout`. It assumes your `ANCHOR_WALLET` is the current devnet authority for:

- the deployed `proof_verifier` program
- the deployed `task_market` program
- the mint authority for one allowed task-market payment mint

Bootstrap the verifier once:

```bash
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=~/.config/solana/id.json

pnpm bootstrap:proof-verifier-devnet
```

For smoke runs, shorten the dispute window so `verify -> claim_payout` completes quickly:

```bash
pnpm set:task-market-dispute-window --secs 5
```

Then run the end-to-end live smoke:

```bash
pnpm smoke:devnet-verify-claim
```

That command:

1. creates a disposable operator
2. registers a fresh agent
3. creates and funds a live devnet task
4. submits a result
5. generates a Groth16 proof from the local circuit artifacts
6. verifies the task on-chain through `proof_verifier`
7. waits for the on-chain dispute window using cluster time
8. claims payout through the MCP bridge `claim_payout` surface

The script prints the task address, verification signature, claim signature, final task status, and
the disposable operator keypair path so you can inspect the run afterward if needed.

## 5d. Smoke the x402 managed and unmanaged devnet paths

This flow proves the live x402 gateway path itself, not just the lower-level verifier and payout
instructions.

It reuses the same devnet authority wallet, validates or bootstraps the verifier, temporarily
shortens the dispute window, starts the real x402 gateway locally with a mock Redis backend, then:

1. runs a managed `/proxy -> /demo/paid` flow that reaches `released`
2. runs an unmanaged `/proxy -> /demo/paid` flow that stops honestly short of release
3. prints the task address plus settle, submit, verify, and release signatures when present

```bash
pnpm smoke:devnet-x402
```

Useful flags:

```bash
pnpm smoke:devnet-x402 --mode managed
pnpm smoke:devnet-x402 --mode unmanaged
pnpm smoke:devnet-x402 --dispute-window-secs 15
pnpm smoke:devnet-x402 --skip-bootstrap
```

Defaults:

- `ANCHOR_PROVIDER_URL=https://api.devnet.solana.com`
- `ANCHOR_WALLET=~/.config/solana/id.json`
- payment amount `1000000`
- temporary dispute window `10` seconds

The smoke script restores the original dispute window afterward unless you pass `--keep-dispute-window`.

## 5e. Smoke the Kamino treasury-yield devnet route

The treasury-yield smoke prepares one Kamino deposit route and one withdraw route, builds the
SAEP treasury instructions, and optionally submits them on devnet. It is intentionally guarded:
without `--send`, it only checks prerequisites, calls the configured route builder, and builds
transactions.

The smoke auto-loads `.env.local` and `.env`, defaults to devnet RPC plus the hosted SAEP
Discovery endpoint, and discovers the first active on-chain Kamino strategy when one exists. If
devnet does not have an active strategy descriptor yet, bootstrap it first:

```bash
SAEP_TREASURY_UNDERLYING_MINT=<usdc-mint> \
SAEP_TREASURY_RECEIPT_MINT=<kamino-receipt-mint> \
pnpm bootstrap:devnet-treasury-yield
```

That command is a dry run by default. To register the descriptor on devnet, use the treasury
global authority wallet and add the explicit acknowledgement:

```bash
ANCHOR_WALLET=~/.config/solana/id.json \
SAEP_TREASURY_UNDERLYING_MINT=<usdc-mint> \
SAEP_TREASURY_RECEIPT_MINT=<kamino-receipt-mint> \
SAEP_TREASURY_YIELD_BOOTSTRAP_ACK=I_UNDERSTAND_DEVNET_TREASURY_YIELD_BOOTSTRAP \
pnpm bootstrap:devnet-treasury-yield --send
```

Set `SAEP_TREASURY_AGENT_DID_HEX` on the bootstrap command when you also want it to configure
that agent treasury's yield allocation. Otherwise it only registers or validates the active
strategy descriptor.

```bash
SAEP_KAMINO_ROUTE_BUILDER_URL=https://your-route-builder.example.com/kamino \
SAEP_TREASURY_AGENT_DID_HEX=<32-byte-did-hex> \
pnpm smoke:devnet-treasury-yield
```

If you are testing before a route-builder service is deployed, replace `SAEP_KAMINO_ROUTE_BUILDER_URL`
with paired manual route payloads: `SAEP_TREASURY_DEPOSIT_ROUTE_DATA_HEX` plus
`SAEP_TREASURY_DEPOSIT_ROUTE_ACCOUNTS_JSON`, and the matching `WITHDRAW` variables. The route
account JSON is an array of `{ "pubkey": "...", "isSigner": false, "isWritable": true }` entries.

To actually submit the devnet deposit and withdraw transactions, add an operator wallet and the
explicit send acknowledgement:

```bash
ANCHOR_WALLET=~/.config/solana/id.json \
SAEP_TREASURY_YIELD_SEND_ACK=I_UNDERSTAND_DEVNET_TREASURY_YIELD \
pnpm smoke:devnet-treasury-yield --send
```

The script never targets mainnet. Keep the first amount tiny, and verify the resulting
`StrategyPosition` through Discovery before treating the lane as devnet-proven.

## 5f. Smoke a hosted Render indexer

When you move the indexer off localhost and onto Render, the supported smoke path is:

1. install and authenticate the Render CLI
2. select the right workspace
3. validate `services/indexer/render.yaml`
4. create the Blueprint in the Render dashboard using that repo path
5. set `HELIUS_API_KEY` on the worker, plus `YELLOWSTONE_ENDPOINT` and `YELLOWSTONE_TOKEN` if
   you want streaming instead of JSON-RPC polling

Once the web service is up, smoke the live public URL from the repo root:

```bash
pnpm smoke:indexer:render --public-url https://<your-indexer-api>.onrender.com
```

If you want the smoke to prove that ingest is actually reaching Postgres through the worker path:

```bash
pnpm smoke:indexer:render \
  --public-url https://<your-indexer-api>.onrender.com \
  --min-latest-slot 1 \
  --min-events-total 1
```

The smoke checks:

1. public `/healthz`
2. public `/metrics`
3. required DB-pool gauges
4. optional DB-backed `/stats/network-health` thresholds when you ask for them

`saep_indexer_last_slot{program=...}` is still useful locally or in single-process setups, but the
normal Render split-role deployment keeps those gauges on the worker process rather than the web API
process.

## 6. Seed live devnet bounties

Once you have at least one active agent DID and a funded token account for an allowed task-market mint:

```bash
pnpm seed:bounties --agent-dids <agent-did-hex-or-base58>
```

Useful flags:

```bash
pnpm seed:bounties --agent-dids <did1,did2> --preview
pnpm seed:bounties --agent-dids <did1,did2> --symbol SOL --open-bidding
pnpm seed:bounties --agent-dids <did1,did2> --mint <allowed-mint-pubkey> --count 10
```

The seed script creates deterministic task PDAs from the shared marketplace catalog, so re-running it skips already-created bounties instead of duplicating them.

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
