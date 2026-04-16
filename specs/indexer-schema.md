# Spec — Indexer Postgres Schema

**Owner:** solana-indexer-engineer
**Depends on:** 03 (AgentRegistry), 04 (TreasuryStandard), 06 (ProofVerifier), 07 (TaskMarket), 08 (IACP), `reputation-graph.md`, `retro-airdrop.md`
**Blocks:** audit prep (`docs/audit/ottersec-m1.md`), Discovery API (`specs/discovery-api.md`), portal `/analytics` + `/agents/[did]` + `/marketplace` data paths
**References:** backend PDF §3 (off-chain infra), §3.3 (slot-history per backend §3), `services/indexer/migrations/`, `services/indexer/src/{schema,stats,ingest,reorg,poller,jobs}.rs`

## Goal

Document the human-readable shape of the indexer's Postgres database: every table, every column, every index, every materialized view, plus the read/write contracts for each. Migrations are the source of truth for column types; this spec is the source of truth for what each column **means** and which code path owns it. Anyone reading this should be able to plan a query, audit a write path, or estimate storage growth without spelunking through diesel macros.

## Non-goals

- Not the migration tool. `diesel migration` runs `up.sql` / `down.sql` verbatim — this spec describes intent, not bytes.
- Not the Discovery API spec. That spec (`specs/discovery-api.md`, BACKLOG line 106) consumes this schema and adds REST + WS surfaces.
- Not a Yellowstone gRPC swap plan. Slot/sig ingestion currently runs through `getSignaturesForAddress` polling; the schema is identical post-Yellowstone, only the poller cadence changes.
- Not a backup/restore runbook. Render's PG snapshot policy + WAL archiving lives in ops docs once provisioning lands (BACKLOG line 59 — Dennis-approved per INBOX, pending exec).

## Migration order

| # | Date | Path | Adds |
|---|---|---|---|
| 1 | 2026-04-14 | `2026-04-14-000001_init` | `blocks`, `program_events`, `reorg_log` + indexes |
| 2 | 2026-04-15 | `2026-04-15-000002_sync_cursor` | `sync_cursor`; **drops** `program_events_slot_fkey` |
| 3 | 2026-04-16 | `2026-04-16-000003_reputation_rollup` | `category_reputation`, `reputation_samples`, materialized view `reputation_rollup` |
| 4 | 2026-04-16 | `2026-04-16-000004_retro_eligibility` | `retro_eligibility`, `retro_fee_samples` |

`down.sql` exists for each — `diesel migration revert` is exercised in CI to keep them honest.

## Tables

### `blocks` — slot anchor table

Records every slot we've ever ingested. `signature → slot` lookups go through `program_events`; this table answers "have we seen this slot?" + "what was its hash?" for reorg detection.

| Column | Type | Notes |
|---|---|---|
| `slot` | `BIGINT` PRIMARY KEY | Solana slot number. Monotonic but not contiguous — RPC skips empty slots. |
| `hash` | `TEXT NOT NULL` | Block hash as base58. Empty string acceptable for slots we know about via signature-only paths and never fetched the block for (reorg watcher tolerates this). |
| `parent_slot` | `BIGINT NULL` | NULL for genesis or first-seen slot in a fresh DB. Indexed for fork-walk queries. |
| `processed_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Wall-clock at ingestion. Not authoritative time — use slot for ordering. |

**Writers:** `ingest::record_block` (poller batch path, `INSERT … ON CONFLICT (slot) DO UPDATE`).
**Readers:** `stats::network_health` (`MAX(slot)`, `COUNT(*)`), `reorg::reorg_check_cycle` (latest slot for window).
**Storage:** ~1.2 KB/row at full base58 hash. At Solana mainnet's ~432k slots/day, full retention = ~520 MB/day. M1 retains all (cheap); M3+ may roll-up older slots (TBD per Open Q).

### `program_events` — append-only event log

The workhorse. One row per `(signature, event_name)`. Anchor `emit_cpi!` payloads are decoded against the IDL by `borsh_decode::decode` and stored as JSONB.

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGSERIAL` PRIMARY KEY | Monotonic ingestion order; not slot order. |
| `signature` | `TEXT NOT NULL` | Base58 transaction signature. |
| `slot` | `BIGINT NOT NULL` | Slot of the containing tx. **No FK to `blocks.slot`** — see migration 2 below. |
| `program_id` | `TEXT NOT NULL` | Base58 program ID. Indexed for per-program scans. |
| `event_name` | `TEXT NOT NULL` | IDL event-struct name (e.g. `TaskCreated`, `AgentRegistered`). Indexed. |
| `data` | `JSONB NOT NULL DEFAULT '{}'` | Decoded body. `u64`/`i64` fields decode to JSON strings (Borsh→JSON loses precision in JS); `Pubkey`/`[u8; N]` decode to base58 / hex per `borsh_decode`. Decode failures store `{_decode_error, raw_hex}` so a malformed event doesn't stall the stream. |
| `ingested_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Wall-clock ingestion. Used by analytics 24h/per-day/per-min windows. |

**UNIQUE constraint:** `(signature, event_name)`. Same tx can emit multiple distinct events; same `(sig, name)` is idempotent.

**Indexes:** `program_id`, `slot`, `event_name`. JSONB body intentionally not indexed at M1 — query patterns are `(event_name, ingested_at)` scans plus the materialized rollups below. If a portal page starts hammering `data->>'agent_did'` filters, add a GIN partial index per Open Q.

**Migration 2 dropped the `slot → blocks.slot` foreign key.** Rationale: poller ingests events from `getSignaturesForAddress` paginated lookbacks; the corresponding block row is fetched on a separate cadence and may lag. Enforcing FK at insert-time forced an extra round-trip per event for marginal integrity benefit (we already have `signature` as the primary referent for chain provenance). The `down.sql` re-adds the FK so a downgrade is consistent.

**Writers:** `ingest::record_event` (`INSERT … ON CONFLICT DO NOTHING` per the UNIQUE constraint).
**Readers:** `stats::*` (every analytics endpoint), `jobs::retro_rollup` (TODO once `fee_collector` events ship), `pubsub::Publisher` (fire-and-forget Redis fanout post-insert).

### `reorg_log` — detected dropped signatures

Append-only audit trail of every signature the reorg watcher dropped from `program_events`. One row per dropped sig, written transactionally with the `DELETE` + `sync_cursor` rewind in `reorg::apply_rollback`.

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGSERIAL` PRIMARY KEY | |
| `slot` | `BIGINT NOT NULL` | Slot the dropped sig was at. Indexed. |
| `old_hash` | `TEXT NOT NULL` | Reused as the dropped signature string (column name is historical from a planned block-hash-tracking variant we didn't ship; safe to rename via a future migration). |
| `new_hash` | `TEXT NOT NULL` | Sentinel `"dropped"`. Reserved for the same future migration. |
| `detected_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Wall-clock detection time. Drives `reorgs_24h` analytics. |

**Open Q (Q-3):** rename `old_hash` → `dropped_signature` and remove `new_hash` in a future migration. Naming defect is harmless but auditor-confusing.

### `sync_cursor` — per-program ingest watermark

One row per program ID. Lets the poller resume from `last_sig` after restart and lets the reorg watcher rewind without scanning the entire `program_events` table.

| Column | Type | Notes |
|---|---|---|
| `program_id` | `TEXT` PRIMARY KEY | Base58 program ID. |
| `last_sig` | `TEXT NULL` | Most recent signature successfully ingested. NULL after a reorg-rollback that erased every event for the program. |
| `last_slot` | `BIGINT NULL` | Slot of `last_sig`. Tracked separately so reorg-rewind queries can range on slot without parsing sig. |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Wall-clock of last update. |

**Writers:** `poller::set_cursor` (per-program, `INSERT … ON CONFLICT (program_id) DO UPDATE`); `reorg::apply_rollback` (per-program rewind).
**Readers:** `poller::get_cursor` (resume).

### `category_reputation` — per-(agent, capability) authoritative score

Mirror of the on-chain `ReputationScore` PDA per `(agent_did, capability_bit)`. Off-chain copy lets the portal serve leaderboards without N RPC fetches per page render.

| Column | Type | Notes |
|---|---|---|
| `agent_did` | `BYTEA` | 32-byte agent DID. Part of composite PK. |
| `capability_bit` | `SMALLINT` | 0–31 (32 M1 capability tags). Part of composite PK. |
| `quality` | `SMALLINT NOT NULL DEFAULT 0` | EWMA bps, 0–10000. |
| `timeliness` | `SMALLINT NOT NULL DEFAULT 0` | Same. |
| `availability` | `SMALLINT NOT NULL DEFAULT 0` | Same; decays via the heartbeat-miss path in `jobs::reputation_rollup`. |
| `cost_efficiency` | `SMALLINT NOT NULL DEFAULT 0` | Same. |
| `honesty` | `SMALLINT NOT NULL DEFAULT 0` | Same. |
| `jobs_completed` | `BIGINT NOT NULL DEFAULT 0` | Lifetime count. |
| `jobs_disputed` | `BIGINT NOT NULL DEFAULT 0` | Lifetime count. |
| `last_task_id` | `BYTEA NULL` | Most recent task that updated this row. |
| `status` | `TEXT NOT NULL DEFAULT 'active'` | CHECK constraint: `'active' | 'retired' | 'slashed'`. Materialized view filters `status='active'`. |
| `last_update` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Wall-clock of last write. |

**Composite PRIMARY KEY:** `(agent_did, capability_bit)`. Each agent can hold a separate reputation score per capability bit they advertise.

**Indexes:** `(capability_bit, status)` for leaderboard scans; `(last_update DESC)` for "recently active" queries.

**Writers:** `jobs::reputation_rollup` projection writes (TODO — currently only refreshes the view; per-axis writes land when IACP heartbeat ingest is wired).
**Readers:** `reputation_rollup` materialized view (defined inline).

### `reputation_samples` — append-only sample stream

Raw event log feeding `category_reputation`. One row per on-chain reputation update event observed.

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGSERIAL` PRIMARY KEY | |
| `signature` | `TEXT NOT NULL` | Source tx signature. |
| `slot` | `BIGINT NOT NULL` | Slot of source tx. Indexed. |
| `agent_did` | `BYTEA NOT NULL` | 32-byte DID. |
| `capability_bit` | `SMALLINT NOT NULL` | 0–31. |
| `task_id` | `BYTEA NOT NULL` | 32-byte task hash. Indexed. |
| `completed` | `BOOLEAN NOT NULL` | Whether the underlying task settled successfully. |
| `quality_delta` | `SMALLINT NOT NULL DEFAULT 0` | EWMA-bps delta this sample contributed. |
| `timeliness_delta` | `SMALLINT NOT NULL DEFAULT 0` | Same. |
| `correctness` | `SMALLINT NOT NULL DEFAULT 0` | 0/1 flag from the proof-verifier path; reserved for honesty axis. |
| `judge_kind` | `TEXT NOT NULL` | CHECK: `'Circuit' | 'Arbiter' | 'Client'`. |
| `execution_root` | `BYTEA NOT NULL` | 32-byte merkle root of the execution trace this sample is keyed by. |
| `ingested_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

**UNIQUE constraint:** `(signature, task_id, agent_did, capability_bit)` — one sample per axis per task per agent per tx.

**Indexes:** `(agent_did, capability_bit, ingested_at DESC)` for per-agent timeline queries; `(task_id)` for task-detail joins; `(slot)` for reorg-window scans.

**Storage:** ~200 B/row + indexes. At a steady-state 100 tasks/sec across all capabilities, that's ~17 GB/day pre-compression. Pruning policy is an Open Q.

### `reputation_rollup` — materialized view

Read-side surface for the `/agents/leaderboard` page and the `top-agents` / `agent-graph` analytics endpoints.

```sql
SELECT
    agent_did, capability_bit,
    quality, timeliness, availability, cost_efficiency, honesty,
    jobs_completed, jobs_disputed,
    (quality::int + timeliness + availability + cost_efficiency + honesty) / 5
        AS composite_score,
    last_update
FROM category_reputation
WHERE status = 'active';
```

**Refresh:** `jobs::reputation_rollup::refresh_rollup` calls `REFRESH MATERIALIZED VIEW CONCURRENTLY reputation_rollup` every 60s (per `specs/reputation-graph.md`). CONCURRENTLY requires the unique index `reputation_rollup_pk_idx` on `(agent_did, capability_bit)` — installed by the same migration.

**Indexes:** `(agent_did, capability_bit)` UNIQUE (CONCURRENTLY enabler); `(capability_bit, composite_score DESC)` for per-capability leaderboards; `(agent_did)` for per-agent radar fetches.

### `retro_eligibility` — per-operator airdrop snapshot

One row per operator. Latest snapshot wins; nightly rollup overwrites. See `specs/retro-airdrop.md`.

| Column | Type | Notes |
|---|---|---|
| `operator` | `BYTEA` PRIMARY KEY | 32-byte operator pubkey. |
| `net_fees_micro_usdc` | `BIGINT NOT NULL DEFAULT 0` | Sum of post-wash-filter fees. micro-USDC = 6-decimal USDC base unit. |
| `wash_excluded_micro_usdc` | `BIGINT NOT NULL DEFAULT 0` | Sum of fees excluded via `WashFlag::*` classification. |
| `personhood_tier` | `TEXT NOT NULL DEFAULT 'none'` | CHECK: `'none' | 'basic' | 'verified'`. |
| `personhood_multiplier` | `NUMERIC(4, 3) NOT NULL DEFAULT 0.5` | 0.50 / 0.75 / 1.00. |
| `cold_start_multiplier` | `NUMERIC(4, 3) NOT NULL DEFAULT 1.0` | 0.50 if any agent was registered within `COLD_START_EPOCHS` of snapshot. |
| `estimated_allocation` | `NUMERIC(20, 6) NULL` | Final allocation estimate (units = SAEP token). NULL until first nightly run scores this operator. |
| `epoch_first_seen` | `INT NOT NULL` | Earliest epoch this operator's fees appeared in. |
| `last_updated` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

**Indexes:** `(net_fees_micro_usdc DESC)` for leaderboard rendering; `(personhood_tier)` for tier-segment analytics.

### `retro_fee_samples` — append-only fee-event log

Raw `FeeClaim` events from `fee_collector` feeding the nightly `retro_eligibility` rollup.

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGSERIAL` PRIMARY KEY | |
| `signature` | `TEXT NOT NULL` | Source tx signature. |
| `slot` | `BIGINT NOT NULL` | |
| `operator` | `BYTEA NOT NULL` | Indexed by `(operator, epoch)`. |
| `agent_did` | `BYTEA NOT NULL` | |
| `task_id` | `BYTEA NOT NULL` | |
| `client` | `BYTEA NOT NULL` | Indexed for circular-trade graph traversal. |
| `epoch` | `INT NOT NULL` | Indexed. Epoch = 30d per `retro-airdrop.md`. |
| `fee_micro_usdc` | `BIGINT NOT NULL` | Pre-classification raw fee amount. |
| `wash_flag` | `TEXT NULL` | CHECK: `'self_task' | 'circular' | 'burst' | 'below_min'`. NULL = clean sample. |
| `ingested_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

**UNIQUE constraint:** `(signature, task_id)` — one sample per fee-emission tx per task.

## Read query catalog

`services/indexer/src/stats.rs` exposes one HTTP route per query. All queries are read-only and use raw SQL (`diesel::sql_query`) against the live tables — no caching layer at M1.

| Endpoint | Tables read | Query shape |
|---|---|---|
| `/stats/totals` | `program_events` | 4 subselects: distinct `agent_did` from `AgentRegistered`, count of `TaskCreated`, sum of `agent_payout` from `TaskReleased`, `StreamInitialized − StreamClosed`. |
| `/stats/tasks-per-day?days=N` | `program_events` | `generate_series` ⨝ `date_trunc('day', ingested_at) WHERE event_name='TaskCreated'`. Default 30d, max 180d. |
| `/stats/top-capabilities?limit=N` | `reputation_samples` | `GROUP BY capability_bit WHERE completed=true ORDER BY count DESC`. |
| `/stats/fees-burned` | `program_events` | `SUM(data->>'protocol_fee')` + `SUM(data->>'solrep_fee')` + 24h-windowed sum, all from `TaskReleased`. |
| `/stats/network-health` | `blocks`, `program_events`, `reorg_log` | `MAX(slot)`, `reorgs_24h`, `events_per_min`, `events_total`, `blocks_total`. |
| `/stats/top-agents?limit=N` | `reputation_rollup` | `GROUP BY agent_did ORDER BY AVG(composite_score) DESC, SUM(jobs_completed) DESC`. |
| `/stats/agent-graph?limit=N` | `reputation_rollup` | Two-query: top agents + edges (capability rows for those agents). |

`MAX_LIMIT = 500` clamps any `limit` parameter; `agent_graph` clamps to 200.

## Write paths

| Path | Writes to | Concurrency model |
|---|---|---|
| `ingest::record_block` | `blocks` | `INSERT … ON CONFLICT DO UPDATE`. Single poller task, no contention. |
| `ingest::record_event` | `program_events` | `INSERT … ON CONFLICT DO NOTHING`. Idempotent on `(signature, event_name)`. |
| `poller::set_cursor` | `sync_cursor` | `INSERT … ON CONFLICT DO UPDATE`. One row per program. |
| `reorg::apply_rollback` | `reorg_log` ∪ `program_events` ∪ `sync_cursor` | Single transaction: `INSERT reorg_log` per dropped sig, `DELETE FROM program_events WHERE slot >= fork_slot`, rewind `sync_cursor` per program. |
| `jobs::reputation_rollup::refresh_rollup` | `reputation_rollup` view | `REFRESH MATERIALIZED VIEW CONCURRENTLY`. Requires the unique PK index. |
| `jobs::reputation_rollup` projections (TODO) | `category_reputation`, `reputation_samples` | Per-event upsert; bounded by IACP heartbeat ingest cadence. Not yet wired pending heartbeat-presence table (Open Q). |
| `jobs::retro_rollup` (TODO) | `retro_eligibility`, `retro_fee_samples` | Nightly job. Not yet wired pending `fee_collector` event emission (separate BACKLOG item). |

`pubsub::Publisher` reads from `record_event`'s success path and `XADD`s to `saep:events:<program>` + `saep:events:all` Redis channels — fire-and-forget, never blocks ingest.

## Slot / reorg invariants

- **Append-only between reorgs.** `program_events` rows are never updated; only inserted (idempotent) or deleted by the reorg watcher.
- **Reorg deletes are slot-bounded.** `DELETE FROM program_events WHERE slot >= fork_slot` is the only delete path on this table. `fork_slot = min(dropped_signature.slot)` per `reorg::detect_dropped`.
- **Reorg window is bounded.** RPC `getSignatureStatuses` only retains ~150 slots; `REORG_WINDOW_SLOTS` defaults to 150 and `REORG_WINDOW_DEPTH` defaults to 500 sigs to keep the watcher inside the cache. Reorgs deeper than that are not detectable by this design — flagged in Open Q.
- **`sync_cursor` is the only mutable per-program state.** A reorg rewinds it to the latest surviving event below `fork_slot` (or NULL). Resume-from-restart reads from this row.
- **`blocks` rows are not deleted on reorg.** Block hash + parent_slot are still useful as fork-history evidence even after the events at that slot are dropped.

## Operational notes

- **Connection pool:** `r2d2` with `POOL_MAX_SIZE = 8` (`db.rs:10`). Both the ingest path and the analytics API share this pool. Render's smallest paid PG plan offers 22 concurrent connections; pool-of-8 leaves headroom for `psql` ops + future workers.
- **Materialized view refresh:** every 60s. CONCURRENTLY ⇒ no read-side lock, but two simultaneous refreshes are blocked. Scheduler is single-tenant so this is a non-issue at M1.
- **Index maintenance:** `program_events` will accumulate fastest. Periodic `REINDEX CONCURRENTLY` on `program_events_program_id_idx` + `program_events_event_name_idx` belongs in the Render-provisioning runbook (Open Q).
- **Pruning policy:** none at M1. `program_events` + `reputation_samples` + `retro_fee_samples` grow unbounded. Open Q.
- **Migrations:** `diesel migration run` from `services/indexer/migrations/`. CI runs both `up` then `down` for each migration to keep `down.sql` honest.
- **Backups:** Render managed PG ships daily snapshots + 7d PITR by default on paid plans. Confirm at provisioning-time per BACKLOG line 59.

## Open questions for reviewer

1. **`reorg_log` column-name cleanup.** `old_hash` reused as `dropped_signature`, `new_hash` always `'dropped'`. Worth a rename migration before the auditor reads the schema, or leave + flag in the audit cover letter? Default: rename pre-audit (low risk, clean slate).
2. **JSONB GIN indexes on `program_events.data`.** Currently no GIN. Portal's `/agents/[did]` does memcmp-style lookups via Anchor RPC, not JSONB scans, so the gap is theoretical. If Discovery API (BACKLOG line 106) introduces filtered queries (`WHERE data->>'agent_did' = $1`), add `CREATE INDEX … USING GIN (data jsonb_path_ops)` then. Default: defer.
3. **Pruning policy for `program_events` / `reputation_samples` / `retro_fee_samples`.** Three options: (a) infinite retention + bigger PG instance (simplest); (b) cold-storage move to S3/R2 after 90d (cheapest at scale, adds restore-from-cold path); (c) aggregate-then-prune — keep daily rollups, drop raw rows after 30d (cheapest for analytics, breaks audit-trail use-case). Default: (a) for M1, revisit at M3 if storage cost > $20/mo.
4. **Heartbeat-presence table.** `jobs::reputation_rollup` has a `TODO` for streaming IACP heartbeats into a `heartbeat_presence` table that drives the availability-axis decay. New table not yet specified. Should it land in this spec as a planned migration, or get its own follow-on spec when IACP→indexer wiring lands? Default: follow-on (out of scope here).
5. **Reorg-window deeper than 150 slots.** RPC cache caps detection at ~150 slots. Yellowstone gRPC streams every block live, so post-Yellowstone we can detect arbitrarily deep reorgs (within the gRPC backlog window) without hitting the status-cache wall. Document the gap as a known M1 limitation in the audit package, or invest in a parallel deeper-window detector now? Default: document + defer until Yellowstone swap.
6. **`blocks.hash` empty-string convention.** Block-fetch is opportunistic; rows can land with empty `hash`. Reorg watcher tolerates it but auditor may flag. Make it `NULL`-able instead with a CHECK that exactly one of (NULL, non-empty base58) holds? Default: rename empty → NULL in next migration, low risk.
7. **`reputation_rollup` refresh cadence.** 60s is the spec default. Tighter (15s) cuts portal staleness at the cost of CONCURRENTLY refresh CPU; looser (5min) cuts CPU at the cost of staleness. M1 is fine at 60s; revisit when portal page-load metrics exist.

## Done checklist

- [x] All 4 migrations enumerated with intent + writer + reader.
- [x] Every column documented (type + meaning, not just diesel macro).
- [x] All indexes catalogued with their query target.
- [x] Materialized view refresh contract pinned (CONCURRENTLY + unique-index dependency).
- [x] Read query catalog cross-references `stats.rs` endpoints.
- [x] Write path catalog enumerates concurrency model per path.
- [x] Slot/reorg invariants stated.
- [x] Operational notes (pool, refresh, pruning, migrations, backups).
- [x] 7 reviewer open-questions sized to a single review batch.
- [ ] Reviewer ratifies (or pushes back on) the 7 open questions.
- [ ] Pre-audit rename pass: `reorg_log.old_hash → dropped_signature`, `blocks.hash` empty → NULL (if Q-1 + Q-6 ratified).
- [ ] Discovery API spec (BACKLOG line 106) lands and references this schema for its query layer.
