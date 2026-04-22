# saep-indexer

Rust service. Streams Solana transactions touching SAEP program IDs, decodes Anchor `emit_cpi!` events against committed IDLs, and persists them to Postgres. Yellowstone gRPC streaming is the default ingest path; falls back to JSON-RPC polling when no streaming endpoint is configured.

Kept out of the root `programs/*` Anchor workspace on purpose — Anchor pins a specific Solana toolchain whereas the indexer wants modern stable Rust and unrestricted dependency versions. `Cargo.toml` declares its own `[workspace]`.

## Ingest mode

Two modes selected at startup based on env:

- **Yellowstone gRPC streaming** (`src/grpc_stream.rs`) — active when `YELLOWSTONE_ENDPOINT` is set. Lower latency, no pagination window. Requires a Helius dedicated node or equivalent provider.
- **JSON-RPC polling** (`src/poller.rs`) — fallback. Uses free-tier `getSignaturesForAddress` + `getTransaction` with per-program Postgres cursor. Fine for devnet at low TPS; M2/M3 mainnet should run streaming.

Decode / schema / pubsub layers are mode-agnostic — the same downstream pipeline writes to Postgres regardless.

## Quick start

```sh
cp .env.example .env
# set HELIUS_API_KEY and DATABASE_URL

cargo install diesel_cli --no-default-features --features postgres
diesel migration run

INDEXER_ROLE=all API_PORT=8081 HEALTHCHECK_PORT=8080 \
INDEXER_RUN_MIGRATIONS=1 \
INDEXER_INTERNAL_API_TOKEN=local-saep-indexer-token \
cargo run -p saep-indexer
```

On macOS the link step needs `libpq`:

```sh
brew install libpq
export LIBRARY_PATH="/opt/homebrew/opt/libpq/lib"
```

Internal health: `curl localhost:8080/healthz` · Metrics: `curl localhost:8080/metrics`.
When `INDEXER_ROLE=all` or `INDEXER_ROLE=api`, the public discovery API listens on
`http://localhost:8081` by default.

## Config

| Env | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | Postgres DSN |
| `HELIUS_API_KEY` | — | Free-tier key works; mainnet + devnet |
| `SOLANA_CLUSTER` | `devnet` | `mainnet` or `devnet` — selects Helius host |
| `SOLANA_RPC_URL` | derived | Set to override the Helius-derived URL |
| `INDEXER_ROLE` | `poller` | `poller`, `api`, or `all`. Use `all` locally when you want ingest plus the public API in one process. |
| `INDEXER_RUN_MIGRATIONS` | `false` | When `1`/`true`, runs Diesel migrations even in `INDEXER_ROLE=api`. Use this for local smoke stacks that only need the read APIs. |
| `POLL_INTERVAL_MS` | `2000` | Polling mode: per-cycle sleep between program scans |
| `RPC_PAGE_LIMIT` | `200` | Polling mode: signatures fetched per call (Helius caps at 1000) |
| `YELLOWSTONE_ENDPOINT` | unset | When set, switches ingest to Yellowstone gRPC streaming. Unset = JSON-RPC polling. |
| `YELLOWSTONE_TOKEN` | unset | Bearer token for the Yellowstone endpoint. Required alongside `YELLOWSTONE_ENDPOINT` for managed providers. |
| `HEALTHCHECK_PORT` | `8080` | Internal `/healthz`, `/metrics`, and authenticated sync routes such as `POST /compute-bonds/snapshots` |
| `API_PORT` | `HEALTHCHECK_PORT + 1` | Public discovery/router port used for `GET /v1/discovery/...` |
| `INDEXER_INTERNAL_API_TOKEN` | unset | Optional Bearer token required by internal mutation routes, including compute-bond snapshot sync |
| `REDIS_URL` | unset | When set, decoded events fan out on `saep:events:<program>` + `saep:events:all`. Unset = fanout disabled, ingest unaffected. |

## Local snapshot-sync smoke path

To exercise the persisted compute-bond read model locally:

1. Run the indexer with `INDEXER_ROLE=all` so it serves both internal and public APIs.
2. Start Discovery against the same Postgres database.
3. Start the compute broker with `INDEXER_INTERNAL_API_URL=http://127.0.0.1:8080` and the same `INDEXER_INTERNAL_API_TOKEN`.
4. From the repo root, run `pnpm smoke:compute-bonds`.

The broker pushes lifecycle snapshots to the internal indexer API, the indexer persists them, and
both Discovery and the public indexer API should converge on the same task-scoped compute-bond
records.

For the self-orchestrating local path, `pnpm smoke:compute-bonds:local` instead starts the indexer
in `INDEXER_ROLE=api` with `INDEXER_RUN_MIGRATIONS=1`, then boots Discovery and the broker around
it automatically.

## IDL regeneration

The decode registry reads committed IDLs at startup. Regenerate from the Anchor workspace at repo root before running:

```sh
anchor build
```

Writes `target/idl/<program>.json` for every M1 program. Default lookup path is `../../target/idl` relative to the crate; override with `SAEP_IDL_DIR`.

## What's wired

- Yellowstone gRPC streaming + JSON-RPC poller (selected at startup) sharing a per-program Postgres cursor
- Inner-instruction walk → Anchor discriminator match → Borsh decode against IDL type tree
- Prometheus `/metrics`: `saep_indexer_events_total{program,event}`, `saep_indexer_rpc_errors_total{method}`, `saep_indexer_last_slot{program}`, `saep_indexer_pubsub_publishes_total{program,status}`
- Diesel schema: `blocks`, `program_events`, `reorg_log`, `sync_cursor`
- Axum health + metrics endpoints
- Redis Pub/Sub fanout (opt-in via `REDIS_URL`) — decoded events broadcast to `saep:events:<program>` and `saep:events:all`

## What's deferred

- Historical backfill beyond RPC pagination window (M2).

## Deploy

`render.yaml` provisions a Render Background Worker + managed Postgres in Frankfurt. Build via the Dockerfile (Linux has libpq available via apt). After the first deploy, set the `sync: false` envs in the Render dashboard: `HELIUS_API_KEY` (always required) and — to activate streaming — `YELLOWSTONE_ENDPOINT` + `YELLOWSTONE_TOKEN`. Without the Yellowstone vars the worker falls back to JSON-RPC polling automatically.
