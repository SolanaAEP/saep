# saep-indexer

Rust service. Subscribes to a Yellowstone gRPC endpoint, filters for SAEP program transactions, and persists block metadata + decoded program events to Postgres. Reorg-aware.

Crate is kept out of the root `programs/*` Anchor workspace on purpose — Anchor pins a specific Solana toolchain whereas the indexer wants modern stable Rust and unrestricted dependency versions. `Cargo.toml` declares its own `[workspace]`.

## Quick start

```sh
cp .env.example .env
# edit DATABASE_URL + YELLOWSTONE_ENDPOINT + YELLOWSTONE_X_TOKEN

cargo install diesel_cli --no-default-features --features postgres
diesel migration run

cargo run -p saep-indexer
```

Health probe: `curl localhost:8080/healthz`.

## Against Helius

Helius exposes Yellowstone at `https://<region>.helius-rpc.com` with the API key passed as the `x-token` gRPC metadata header. Set `YELLOWSTONE_ENDPOINT` to the https URL and `YELLOWSTONE_X_TOKEN` to the key. The subscription filters transactions where any of the 8 SAEP program IDs (see `src/programs.rs`) appear in the account list, at `Confirmed` commitment.

## What's wired

- Yellowstone connection + subscribe request for the 8 SAEP program IDs.
- Block meta + transaction update handling (dispatch only; see stubs).
- Diesel schema + initial migration for `blocks`, `program_events`, `reorg_log`.
- r2d2 connection pool.
- Axum health endpoint on `HEALTHCHECK_PORT`.
- Config loader from `.env` via `dotenvy`.

## What's stubbed

- `// REORG-LOGIC-STUB` — `src/reorg.rs` has the function signatures and SQL intent, no implementation yet.
- `// EVENT-DECODE-STUB` — no Anchor IDL decoding; once `target/idl/*.json` is emitted by `anchor build`, `ingest::decode_event` will load them and dispatch on the 8-byte event discriminator.
- `// METRICS-STUB` — no Prometheus exporter; lag / ingest rate / reorg counters need wiring.
- No backfill / catch-up from historical slots (M2 concern).
- No Redis pubsub fan-out (IACP bus consumer — M2).

## Ops notes

- One Diesel pool, max 8 connections. Adjust when running behind Render's pgbouncer.
- Migrations are checked into the repo, not baked into the binary. Run `diesel migration run` before the first deploy; schema is idempotent on subsequent boots.
- Reorg depth assumption: < 64 slots at Confirmed commitment. Anything deeper implies network-level issue, not indexer issue — log and alert.
