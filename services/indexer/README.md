# saep-indexer

Rust service. Polls Solana RPC (via Helius) for transactions touching SAEP program IDs, decodes Anchor `emit_cpi!` events against committed IDLs, and persists them to Postgres.

Kept out of the root `programs/*` Anchor workspace on purpose — Anchor pins a specific Solana toolchain whereas the indexer wants modern stable Rust and unrestricted dependency versions. `Cargo.toml` declares its own `[workspace]`.

## Why polling, not Yellowstone

The backend spec assumes Yellowstone gRPC. Helius Laserstream (their Yellowstone surface) starts at $499/mo. For M1 on devnet with low TPS this is massive overkill. The poller uses free-tier `getSignaturesForAddress` + `getTransaction`, writes a per-program cursor to Postgres, and keeps the IDL registry / decode / schema layer intact. Swap to Yellowstone later by replacing `src/poller.rs` — everything downstream stays.

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
| `POLL_INTERVAL_MS` | `2000` | Per-cycle sleep between program scans |
| `RPC_PAGE_LIMIT` | `200` | Signatures fetched per call (Helius caps at 1000) |
| `HEALTHCHECK_PORT` | `8080` | `/healthz` + `/metrics` |
| `REDIS_URL` | unset | When set, decoded events fan out on `saep:events:<program>` + `saep:events:all`. Unset = fanout disabled, ingest unaffected. |

## IDL regeneration

The decode registry reads committed IDLs at startup. Regenerate from the Anchor workspace at repo root before running:

```sh
anchor build
```

Writes `target/idl/<program>.json` for every M1 program. Default lookup path is `../../target/idl` relative to the crate; override with `SAEP_IDL_DIR`.

## What's wired

- RPC poller with per-program Postgres cursor
- Inner-instruction walk → Anchor discriminator match → Borsh decode against IDL type tree
- Prometheus `/metrics`: `saep_indexer_events_total{program,event}`, `saep_indexer_rpc_errors_total{method}`, `saep_indexer_last_slot{program}`, `saep_indexer_pubsub_publishes_total{program,status}`
- Diesel schema: `blocks`, `program_events`, `reorg_log`, `sync_cursor`
- Axum health + metrics endpoints
- Redis Pub/Sub fanout (opt-in via `REDIS_URL`) — decoded events broadcast to `saep:events:<program>` and `saep:events:all`

## What's deferred

- Historical backfill beyond RPC pagination window (M2).

## Deploy

`render.yaml` provisions a Render Background Worker + managed Postgres in Frankfurt. Build via the Dockerfile (Linux has libpq available via apt). Set `HELIUS_API_KEY` manually after the first deploy — it's marked `sync: false` so Render doesn't try to seed it.
