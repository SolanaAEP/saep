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

cargo run -p saep-indexer
```

On macOS the link step needs `libpq`:

```sh
brew install libpq
export LIBRARY_PATH="/opt/homebrew/opt/libpq/lib"
```

Health: `curl localhost:8080/healthz` · Metrics: `curl localhost:8080/metrics`.

## Config

| Env | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | Postgres DSN |
| `HELIUS_API_KEY` | — | Free-tier key works; mainnet + devnet |
| `SOLANA_CLUSTER` | `devnet` | `mainnet` or `devnet` — selects Helius host |
| `SOLANA_RPC_URL` | derived | Set to override the Helius-derived URL |
| `POLL_INTERVAL_MS` | `2000` | Polling mode: per-cycle sleep between program scans |
| `RPC_PAGE_LIMIT` | `200` | Polling mode: signatures fetched per call (Helius caps at 1000) |
| `YELLOWSTONE_ENDPOINT` | unset | When set, switches ingest to Yellowstone gRPC streaming. Unset = JSON-RPC polling. |
| `YELLOWSTONE_TOKEN` | unset | Bearer token for the Yellowstone endpoint. Required alongside `YELLOWSTONE_ENDPOINT` for managed providers. |
| `HEALTHCHECK_PORT` | `8080` | `/healthz` + `/metrics` |
| `REDIS_URL` | unset | When set, decoded events fan out on `saep:events:<program>` + `saep:events:all`. Unset = fanout disabled, ingest unaffected. |

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
