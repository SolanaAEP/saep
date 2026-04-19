# Spec — Discovery API

**Owner:** solana-indexer-engineer + frontend-engineer (consumer)
**Depends on:** `specs/indexer-schema.md`, `specs/08-iacp-bus.md`, `specs/03-program-agent-registry.md`, `specs/07-program-task-market.md`, `specs/04-program-treasury-standard.md`
**Blocks:** portal `/marketplace` (server-side search), portal `/tasks` list view, portal `/agents/[did]` history + radar, analytics live wiring beyond the 7 `stats::*` roll-ups, A2A marketplace panel (M2), SDK `@saep/sdk/discovery` client
**References:** backend PDF §3 (off-chain infra), frontend PDF §2.3 (Marketplace), §2.5 (Tasks), §3.1 (SIWS), §3.4 (optimistic UI), `services/indexer/src/{api,stats,pubsub}.rs`

## Goal

Replace browser-originated `getProgramAccounts` memcmp scans (current pattern across `useAllAgents`, `useAgentTasks`, `useTasksByCreator`) with a server-side REST + WS surface hitting the indexer's Postgres schema. Two effects: (1) shifts the read-heavy filter+sort path off mainnet RPC, where 5 memcmp scans per marketplace load is a cost + latency tax that does not scale past a few hundred agents, and (2) gives realtime consumers a single bearer-auth'd WS channel for agent / task / treasury state transitions without standing up a per-page Yellowstone subscription.

## Non-goals

- **Not a write surface.** All mutations stay SDK → RPC → chain. Discovery is read-only.
- **Not the analytics API.** `services/indexer/src/stats.rs` already owns `/stats/*` — 7 fixed-shape aggregate endpoints for the public analytics page. Discovery adds row-level search + subscription; aggregate roll-ups stay there.
- **Not the IACP bus.** IACP (`specs/08-iacp-bus.md`) moves *signed agent-to-agent envelopes*; Discovery moves *indexed chain state*. Overlap is zero — different auth model, different payload shape, different delivery guarantees.
- **Not a Yellowstone gRPC passthrough.** Consumers that need raw chain events (validators, audit tooling) should subscribe to Yellowstone directly via Helius dedicated. Discovery WS delivers decoded, filtered, schema-stable events.
- **Not a historical backfill tool.** Initial implementation serves live + recent (≤30d default) state; deeper history is Open-Q #8.

## Service placement

Discovery lives as a **standalone TS service** at `services/discovery/` (fastify 5 + @fastify/websocket + pg + zod) serving `/v1/discovery/*`. The indexer binary retains a legacy `/api/*` alias in `services/indexer/src/discovery.rs` (Rust shim over the same matviews) until portal callers migrate off `useAgentReputation` et al., at which point the shim retires. Both paths read the same Postgres matviews (`agent_directory` / `task_directory` / `reputation_rollup`); no schema divergence.

The original M1 plan (cycle 106) was to land discovery inside the indexer binary as `services/indexer/src/api/discovery.rs` on the `stats::router()` pattern — rationale was shared PG + Redis pools, one deploy target, no connection-pool doubling. The standalone-TS path landed instead (public `47e29c9`) to let the read path evolve on the TS/zod/fastify stack the rest of the web tier already uses; the editorial drift is tracked in `INBOX.md`. Matview access works identically over a separate PG connection pool at M1 scale; re-fold into the indexer binary is a file-move + `main.rs` edit, not a schema migration, if the connection-pool footprint becomes load-bearing at M3.

## Surface — REST

Base path: `/v1/discovery`. All responses JSON. Errors follow `{error, detail?, request_id}` with `request_id` correlating to a `saep_indexer_request_id` log field.

### Agents

| Method + path | Purpose | Query params | Response |
|---|---|---|---|
| `GET /agents` | Filtered + ranked agent list | `capability_mask` (hex u64, required unless `operator` supplied), `min_reputation` (u16 composite 0-10000), `max_base_price` (u64 lamports), `status` (`active`/`slashed`/`paused`, default `active`), `operator` (base58, mutually exclusive w/ `capability_mask`), `cursor` (opaque), `limit` (default 50, max 200), `sort` (`reputation_desc`/`price_asc`/`recent_desc`, default `reputation_desc`) | `{items: AgentSummary[], cursor: string?, total: number?}` |
| `GET /agents/:did` | Single agent detail | — | `AgentDetail` (full `ReputationScore` + `TreasurySummary` + last 10 task ids) |
| `GET /agents/:did/tasks` | Tasks for agent, paginated | `status` (filter by TaskStatus enum), `cursor`, `limit` | `{items: TaskSummary[], cursor?}` |
| `GET /agents/:did/streams` | Active payment streams | `status` (`open`/`closed`, default `open`) | `{items: StreamSummary[]}` |
| `GET /agents/:did/reputation` | Full reputation time series | `bucket` (`day`/`week`, default `day`), `days` (max 90) | `{series: ReputationPoint[]}` |

Shape types below. `total` is returned only when a `WHERE` clause narrows the result set below a cheap-count threshold (~10k rows per Postgres `EXPLAIN` budget); for wider queries it is `null` + the UI shows "50+".

### Tasks

| Method + path | Purpose | Query params | Response |
|---|---|---|---|
| `GET /tasks` | Filtered task list | `status` (comma-sep), `creator` (base58), `agent_did` (hex-32), `capability_mask` (hex), `created_after` (RFC3339), `created_before` (RFC3339), `cursor`, `limit`, `sort` (`created_desc`/`deadline_asc`/`reward_desc`, default `created_desc`) | `{items: TaskSummary[], cursor?}` |
| `GET /tasks/:task_id_hex` | Single task detail | — | `TaskDetail` (full `TaskContract` + current escrow balance + proof verify status) |
| `GET /tasks/:task_id_hex/timeline` | State transitions | — | `{events: TaskEvent[]}` (parsed from `program_events` rows with `event_name` ∈ `{TaskCreated, BidBookOpened, BidCommitted, BidRevealed, BidBookClosed, ResultSubmitted, TaskVerified, VerificationFailed, TaskReleased, DisputeRaised, TaskExpired, TaskCancelled}`) |

### Capabilities

| Method + path | Purpose | Response |
|---|---|---|
| `GET /capabilities` | All approved tags from `CapabilityRegistry` | `{items: CapabilityTag[]}` (cached 300s) |
| `GET /capabilities/:bit` | One tag + manifest URI | `CapabilityTag` |

### Treasury

| Method + path | Purpose | Query params | Response |
|---|---|---|---|
| `GET /treasury/:did` | Treasury overview | — | `{vaults: VaultBalance[], allowed_mints: AllowedMint[], spend_window: SpendWindow}` |
| `GET /treasury/:did/vaults` | Per-mint vault balances | `mint` (optional filter) | `{items: VaultBalance[]}` |

### Shape types

```ts
interface AgentSummary {
  did_hex: string;            // 32-byte hex
  operator: string;            // base58 pubkey
  capability_mask: string;     // hex u64
  reputation_composite: number;// 0-10000 bps
  base_price_lamports: string; // u64 as string (JSON-safe)
  status: "active" | "slashed" | "paused";
  manifest_uri: string | null;
  last_active_unix: number;
}

interface AgentDetail extends AgentSummary {
  reputation: {
    quality: number; timeliness: number; availability: number;
    cost_efficiency: number; honesty: number;
  };
  jobs_completed: number;
  jobs_disputed: number;
  stake_lamports: string;
  treasury_summary: { allowed_mints: number; active_streams: number };
  recent_task_ids_hex: string[];  // up to 10
}

interface TaskSummary {
  task_id_hex: string;
  creator: string;
  agent_did_hex: string | null;  // null until accepted
  status: TaskStatus;
  reward_lamports: string;
  capability_mask: string;
  created_at_unix: number;
  deadline_unix: number;
}

interface TaskDetail extends TaskSummary {
  payload_hash_hex: string;
  result_hash_hex: string | null;
  proof_verified: boolean | null;   // null until proof_verifier sees it
  escrow_balance_lamports: string;
  dispute_opened: boolean;
}

interface StreamSummary {
  stream_id_hex: string; from: string; to: string; mint: string;
  rate_per_sec: string; start_unix: number; end_unix: number | null;
  total_paid: string; status: "open" | "closed";
}

interface CapabilityTag {
  bit: number; slug: string; manifest_uri: string; approved: boolean;
}

interface VaultBalance { mint: string; balance: string; decimals: number; }
interface AllowedMint { mint: string; per_tx_cap_base_units: string; }
interface SpendWindow { spent_24h_base_units: string; limit_24h_base_units: string; }
```

All `u64`/`i64` returned as JSON strings (per `borsh_decode` contract — JS loses precision at 2^53). Timestamps are unix seconds (int), not RFC3339, to match on-chain `i64` timestamps in `program_events.data`. Hex fields are lowercase, unprefixed.

## Surface — WebSocket

Base path: `/v1/discovery/ws`. One socket per client. Subscription-scoped — client sends `{op: "subscribe", channel, filter?}`, server confirms `{op: "subscribed", id}`, then streams `{op: "event", id, data}` frames. Server-initiated `{op: "keepalive", unix}` every 20s; client drops if two are missed.

### Channels

| Channel | Events | Filter schema |
|---|---|---|
| `agents` | `AgentRegistered`, `ManifestUpdated`, `StakeIncreased`, `SlashExecuted`, `SlashCancelled`, `StatusChanged` | `{did_hex?, operator?, capability_mask?}` |
| `tasks` | `TaskCreated`, `BidBookOpened`, `BidRevealed`, `BidBookClosed`, `ResultSubmitted`, `TaskVerified`, `VerificationFailed`, `TaskReleased`, `DisputeRaised`, `TaskExpired`, `TaskCancelled` | `{task_id_hex?, client?, agent_did_hex?, status?}` |
| `treasury` | `VaultInitialized`, `DepositReceived`, `WithdrawExecuted`, `SwapExecuted`, `StreamInitialized`, `StreamClosed`, `LimitUpdated` | `{did_hex?, mint?}` |
| `proofs` | `ProofVerified`, `VerificationFailed`, `VkActivated` | `{task_id_hex?, vk_id?}` |

Filters are ANDed within a subscription; multiple subscriptions can coexist on one socket. Max 16 concurrent subs per socket; 17th is rejected with `{op: "error", reason: "sub_limit"}`. Rate-limited to 256 subscribe ops / connection-lifetime to prevent subscribe-flood churn.

### Delivery model

WS events mirror Redis Streams entries written by `pubsub::Publisher` (`services/indexer/src/pubsub.rs`, cycle ref). Publisher already fires `saep:events:<program>` + `saep:events:all` on every successful `record_event`. Discovery's WS handler maintains one shared `redis::aio::ConnectionManager` per instance, subscribes to the four logical channels above (mapped to a union of program channels + event-name filter), and fans out to bound sockets matching each sub's filter. **At-most-once** delivery semantics — no replay, no durable cursor. Consumers that need backfill must do an initial `GET /agents/...` or `GET /tasks/...` paginated seed before subscribing (same pattern as `useAllAgents` + `useAgentStream` composition in sdk-ui).

Trade-off: a durable cursor (`?since_id=<redis_stream_id>`) would handle WS disconnect + reconnect gaps. Deferred to Open-Q #5 — the common failure mode (browser tab sleep) is better served by "re-fetch on reconnect" which is already the Tanstack Query default.

## Auth model

- **Public REST + WS reads:** no auth required for agent / task / capability / treasury-balance queries. All on-chain events are public by observation; the API merely shapes them. CORS: `*` on `/v1/discovery/*` GETs.
- **Authenticated augmented fields:** when a SIWS session cookie is present (same `saep_session` cookie minted by portal `/api/auth/verify`, shared `verifySessionJwt` from `@saep/sdk/auth/session`), responses include owner-scoped fields: `TreasuryDetail.spend_window`, `AgentDetail.stake_pending_withdrawal`, per-stream `unclaimed_amount`. Without a cookie those fields are omitted (not nulled — omission makes cache-keying cleaner).
- **Rate-limit scope differs by auth:** anonymous callers are bucketed per source-IP via `X-Forwarded-For` (100 req/min per endpoint class); authenticated callers are bucketed per `sub` claim (500 req/min). Implementation reuses `iacp`'s `KeyedRateLimiter` pattern (`services/iacp/src/rate_limit.ts`, ported to Rust as `services/indexer/src/rate_limit.rs` — Open-Q #4).
- **WS auth:** bearer token via query string `?token=<ws-token>` minted by portal `/api/auth/ws-token` (5-min TTL, HS256, issuer `saep.portal` per cycle-62 shared verifier). Same verifier IACP uses — **one** session-JWT scheme across the platform. Unauthenticated WS connections accepted but restricted to the `agents` + `capabilities` channels with public fields only (no `treasury` / `proofs` subs, no augmented fields).

## Caching — Redis TTLs

`redis::aio::ConnectionManager` singleton in `ApiState`, keyed `disc:<endpoint>:<hash(query)>`.

| Endpoint | TTL | Invalidation |
|---|---|---|
| `GET /agents` (filtered list) | 30s | Event-driven invalidation on `AgentRegistered` / `StatusChanged` / `ManifestUpdated` (publisher subscribes to `saep:events:agent_registry` and `DEL`s prefix `disc:agents:*`). |
| `GET /agents/:did` | 60s | Same event-driven invalidation, narrower key (`disc:agents:did:<did>`). |
| `GET /agents/:did/tasks` | 15s | `disc:agents:tasks:<did>` invalidated on `TaskCreated` / `BidBookClosed` / `ResultSubmitted` / `TaskReleased` / `DisputeRaised` / `TaskExpired` / `TaskCancelled` with `agent_did == <did>`. |
| `GET /tasks` (filtered list) | 10s | Too high cardinality for event-driven invalidation; short TTL + stampede protection (single-flight via `redis SET NX` lock, 2s timeout). |
| `GET /tasks/:task_id_hex` | 30s | Event-driven on any task-state event for that `task_id`. |
| `GET /tasks/:task_id_hex/timeline` | 60s | Append-only underlying data; TTL is the only invalidator (events append but never rewrite). |
| `GET /capabilities` | 300s | Event-driven on `CapabilityTagProposed` / `CapabilityTagApproved` / `CapabilityTagRetired`. |
| `GET /treasury/:did` | 20s | Event-driven on `treasury_standard` events for that did. |
| All WS responses | n/a | Redis-backed pubsub is the delivery substrate, not cached. |

Cache-miss path: DB query → format → `SET EX <ttl>` → return. Cache-hit serves directly from Redis. `X-Cache: HIT|MISS` header on all REST responses.

## Pagination

Opaque cursor — base64-encoded `{last_id, last_sort_value}` tuple scoped to the sort key. Cursor-based rather than offset-based to survive insertions during pagination (offset-based would double-serve rows when new events land mid-scroll). Max 200 items per page (prevents memory spikes on denormalized joins). Cursor TTL unbounded on the wire but server re-parses every request — an old cursor against a post-migration schema returns `400 invalid_cursor`.

## Query implementation

Reads hit these tables from `specs/indexer-schema.md`:
- `program_events` (primary source of truth for all agent / task / treasury state — event-sourced)
- `reputation_rollup` materialized view (composite score + dims, refreshed 60s)
- `category_reputation` (per-capability-bit reputation — the five dims)

No new tables at M1. Two denormalized views live alongside `reputation_rollup` for search efficiency:

### Materialized view — `agent_directory`

Refreshed every 60s alongside `reputation_rollup`. One row per agent, folding latest `AgentRegistered` + `ManifestUpdated` + `StakeIncreased` + `SlashExecuted` events.

| Column | Type | Source |
|---|---|---|
| `agent_did` | `BYTEA` (32) PRIMARY KEY | event `data->>'agent_did'` |
| `operator` | `TEXT` (base58) | latest `AgentRegistered.operator` |
| `capability_mask` | `NUMERIC(20)` (u64 as numeric) | latest `ManifestUpdated.capability_mask` else `AgentRegistered.capability_mask` |
| `base_price_lamports` | `NUMERIC(20)` | latest `ManifestUpdated.base_price` (M1: event lacks `base_price`; column omitted from matview until event payload extends — see migration `2026-04-17-000005_discovery_views`) |
| `reputation_composite` | `INT` | join `reputation_rollup.composite_score` (capability-weighted avg per Open-Q #2) |
| `status` | `TEXT` | derived: `slashed` if any `SlashExecuted` (post-execution slash is terminal at M1; `SlashCancelled` only offsets pre-execution `SlashProposed`); `paused` if latest `StatusChanged.new_status = 1`; else `active` |
| `manifest_uri` | `TEXT` | latest `ManifestUpdated.manifest_uri` (M1: event lacks `manifest_uri`; column is `NULL::text` stub until event payload extends) |
| `last_active_unix` | `BIGINT` | max(slot-time) across any event with this did |
| `refreshed_at` | `TIMESTAMPTZ` | `now()` at refresh |

Indexes: `(capability_mask, reputation_composite DESC)`, `(status, reputation_composite DESC)`, `(operator)`.

### Materialized view — `task_directory`

Same cadence. One row per task, folding latest state transition.

| Column | Type | Source |
|---|---|---|
| `task_id` | `BYTEA` (32) PRIMARY KEY | `data->>'task_id'` |
| `creator` | `TEXT` | `TaskCreated.client` |
| `agent_did` | `BYTEA` NULL | `TaskCreated.agent_did` (IDL carries `agent_did` on create; no separate `TaskAccepted` event at M1 — acceptance is signalled by `BidBookClosed.winner_agent`) |
| `status` | `TEXT` | derived from latest state event |
| `reward_lamports` | `NUMERIC(20)` | `TaskCreated.payment_amount` |
| `capability_mask` | `NUMERIC(20)` | `TaskCreated.required_capabilities` (M1: event lacks this field; column is `NULL::numeric` stub until event payload extends — `(capability_mask, reward_lamports DESC)` index searches over NULLs) |
| `created_at_unix` | `BIGINT` | `TaskCreated.timestamp` |
| `deadline_unix` | `BIGINT` | `TaskCreated.deadline` |
| `updated_at_unix` | `BIGINT` | max slot-time across all events for this task |

Indexes: `(status, created_at_unix DESC)`, `(creator, created_at_unix DESC)`, `(agent_did, created_at_unix DESC)`, `(capability_mask, reward_lamports DESC)`.

**Refresh contract:** `REFRESH MATERIALIZED VIEW CONCURRENTLY` — requires unique index on PK, which is satisfied. Refresh takes ~200ms for 10k agents + 50k tasks per `EXPLAIN` budget; acceptable at M1 scale, reconsider at 100k+.

## Rate limits + quotas

Anonymous: 100 req/min per IP per endpoint-class (5 classes: agents / tasks / treasury / capabilities / catch-all). Authenticated: 500 req/min per `sub` claim. WS: 10 subscribe ops / min per connection, 1024 max queue depth per sub (events dropped on backpressure with `{op: "dropped", id, count}` frame). Envelope: 64 KiB max WS frame.

Over-limit REST returns `429` with `Retry-After` header (int seconds). Over-limit WS returns `{op: "error", reason: "rate_limit", retry_after_ms}` and closes the offending sub (not the socket).

## Metrics

New Prometheus surface:

- `saep_discovery_request_total{endpoint, status}` — request count by endpoint class + HTTP status
- `saep_discovery_request_duration_seconds{endpoint}` — histogram, 5ms..5s buckets
- `saep_discovery_cache_hits_total{endpoint}` / `saep_discovery_cache_misses_total{endpoint}`
- `saep_discovery_ws_connections` — gauge
- `saep_discovery_ws_subscriptions{channel}` — gauge per channel
- `saep_discovery_ws_events_sent_total{channel}`
- `saep_discovery_ws_events_dropped_total{channel,reason}` — `rate_limit` / `queue_full` / `auth_downgrade`
- `saep_discovery_rate_limited_total{scope, endpoint}` — `scope` ∈ `ip`/`sub`/`ws`
- `saep_discovery_db_query_duration_seconds{query}` — histogram per named query

All metrics share the existing `/metrics` endpoint via the indexer's prom-client registry.

## Error taxonomy

| Code | HTTP | Meaning |
|---|---|---|
| `invalid_param` | 400 | Query param failed schema parse (hex length, enum value, range) |
| `invalid_cursor` | 400 | Cursor from older schema or malformed base64 |
| `unauthorized` | 401 | SIWS cookie required but missing / expired — only raised when authenticated-only field is explicitly requested (anonymous callers just get reduced response) |
| `forbidden` | 403 | IACP `agent_status != active` for agent-scoped endpoints where the caller is subject-agent |
| `not_found` | 404 | DID / task_id / capability_bit not in directory |
| `rate_limit` | 429 | Rate-limit bucket empty; `Retry-After` set |
| `cache_unavailable` | 503 | Redis unreachable; sets `Retry-After: 2` |
| `internal` | 500 | Unhandled — logged with `request_id` |

## Security checks (§5.1 mapping)

- **No escalation of read scope via crafted queries.** All filters are parameterized; no string concatenation into SQL. `did_hex` / `task_id_hex` / `operator` parsed to fixed-length bytes before query binding.
- **No cross-tenant leakage via session confusion.** SIWS session cookie is `HttpOnly, Secure, SameSite=Strict`; the augmented-field path reads `sub` claim only, never mirrors request-body-supplied identifiers into auth scope.
- **No unbounded memory on WS.** Per-sub queue cap 1024, per-connection total 8192; overflow drops events with metric + frame, never grows heap.
- **No cache-poisoning via cursor.** Cursor is opaque server-side; we re-parse + re-validate on every request; a hostile cursor can only select arbitrary rows within the public result set, not pivot to authenticated rows.
- **No RPC leak.** Indexer holds Helius dedicated RPC creds; Discovery is a read over Postgres + Redis and never proxies RPC. Browser still talks to Helius via the Vercel Edge RPC proxy (frontend PDF §3.2) for chain-direct calls.
- **No PII in logs.** `request_id` + endpoint + status only. IP is hashed before logging per the current `axum-extra::middleware::request_id` convention; SIWS `sub` is logged as the first 8 chars only.
- **No bypass of on-chain truth.** Discovery is a read cache; consumers that act on state (hire agent, raise dispute) must re-verify on-chain via SDK before signing. Optimistic UI (`useSendTransaction` from sdk-ui) already does a `simulateTransaction` preflight against the user's RPC which catches stale Discovery reads.
- **No circular auth via IACP.** IACP's `agent_status` check CPIs into agent_registry directly; Discovery's `agents/:did` reads cached `agent_directory.status` which can lag up to 60s. IACP must continue doing its own on-chain check — Discovery's cached status is UX-only (greys out UI buttons), never a security boundary.

## DOS surface

- **Hot-key Redis:** a viral agent's `/agents/:did` can burn through the 60s TTL. Mitigation: Redis `SET NX` single-flight lock (same pattern as the `/tasks` list). First request populates, concurrent requests wait 2s or fall through to DB.
- **Cursor exhaustion:** cursors don't persist server state, but deep scan cursors let a client walk the full `program_events` table in pages. Mitigation: 200-item cap per page + composite-index-only query plans (verified via `EXPLAIN ANALYZE` at authoring time).
- **WS subscribe storm:** a malicious socket subscribes 16 times and disconnects + reconnects. Mitigation: per-IP connection cap (32 concurrent), per-IP subscribe-op rate limit (100/min across all connections from that IP).
- **Publisher gap:** Redis pubsub delivery is at-most-once. A dropped publish means a WS consumer misses an event. Mitigation: every WS consumer does a `GET` seed on subscribe + each `/agents/:did` / `/tasks/:task_id` response carries `etag` (last-event-id) for optimistic consistency.

## Devnet bring-up

- Deploys alongside the indexer. No separate DNS / ingress / TLS — routed under the indexer's existing Render public URL at `/v1/discovery/*`.
- No keys, no multisig, no on-chain authority. Provisioning is config-only: `DISCOVERY_ENABLED=true`, reuses `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET` from indexer env.
- Feature-flag gate at `main.rs::build_router` — unset env disables route registration; health probe unaffected.
- First-boot behavior: if `agent_directory` / `task_directory` materialized views are missing (pre-migration state), endpoints return `503 cache_unavailable` until the next 60s refresh. Migration adds the views as part of `2026-04-17-000005_discovery_views` (new, lands with the implementation).

## CPI / external surface

None. Discovery reads Postgres + Redis; writes are event-driven invalidation `DEL`s against Redis. No Solana RPC calls from the Discovery code path — all chain reads are mediated by the indexer's existing poller + reorg watcher.

## CU budget

N/A — off-chain. Per-endpoint latency budgets:
- cache hit: <20ms p99
- cache miss (indexed): <80ms p99
- cache miss (full scan, cursor deep-walk): <400ms p99 (hard timeout 2s returns `503`)
- WS event fan-out: <50ms p99 from publisher → socket

## Open questions — for reviewer (maintainer + OtterSec + frontend-engineer)

1. **Composite-reputation weighting.** `reputation_rollup.composite_score` is currently a flat average across the five dims. For `agent_directory.reputation_composite`, should we re-weight per capability (e.g. quality matters more for `code-generation`, timeliness for `oracle-query`)? Default: flat average for M1; per-capability weights as a post-M1 tuning pass with governance control at M2.
2. **`total` row-count policy.** Exact-count via `COUNT(*)` on wide filters can touch >100k rows. Alternatives: (a) return `null` above threshold (current spec); (b) return capped count (`"100+"`); (c) return estimate via `pg_class.reltuples`. Default: (a) — cleanest to render client-side.
3. **WS durable cursor.** Should WS support `?since_id=<redis_stream_id>` on subscribe to replay missed events across disconnect? Default: no at M1 (relies on refetch-on-reconnect); revisit if tab-sleep gap becomes visible.
4. **Rate-limiter Rust port.** IACP's `KeyedRateLimiter` is TypeScript (`services/iacp/src/rate_limit.ts`). Port to Rust, or use `tower_governor` crate? Default: `tower_governor` for the HTTP surface, hand-rolled per-sub limiter for WS (different shape — bandwidth + op-count axes).
5. **Cache invalidation vs event stampede.** Mass-invalidation (e.g. `DEL disc:agents:*` on any `AgentRegistered`) wipes the filtered-list cache ~1x/s during heavy registration periods. Alternative: per-filter-hash invalidation via reverse index. Default: blunt `DEL *` at M1; optimize if cache hit rate drops below 60% in prod.
6. **Materialized view refresh cadence.** 60s matches `reputation_rollup`. For `task_directory`, state changes per-task are user-visible and 60s is sluggish. Options: (a) lower to 15s for both (doubles the REFRESH cost); (b) make `task_directory` event-driven (trigger-based incremental update); (c) keep 60s + rely on WS for immediate feedback. Default: (c) for M1 — WS already handles the UX latency case.
7. **`/agents/:did/reputation` time-series depth.** 90d cap matches analytics endpoints but agent onboarding will want longer views. Default: 90d for M1, extend to 365d + archive older at M3 when we know storage pressure.
8. **Historical backfill.** Indexer currently retains all `program_events`; no pruning at M1. Discovery returns the full history through `task_directory` / cursor pagination. At what scale does this stop being free? Default: flag at 10M events (per-month growth at expected M1 traffic); revisit then.
9. **SDK client shape.** Portal consumes Discovery via a new `@saep/sdk/discovery` submodule. Shape mirrors REST endpoints as typed functions + sdk-ui hooks (`useAgentSearch`, `useTaskSearch`, `useAgentDetail`). Auth inheritance: same SIWS cookie flow portal already has. Open: zod runtime schema per response type, or TS-only? Default: zod, matches existing SDK accounts-module pattern.
10. **A2A cross-agent discovery at M2.** Agent-to-agent hiring (agent hires sub-agent) will need a programmatic discovery channel — same endpoints with agent wallet SIWS, or a dedicated `/v1/discovery/a2a` with IACP-envelope auth? Default: reuse endpoints + session, add A2A-specific filters (e.g. `requires_reputation_attestation`) at M2; a dedicated path only if auth model diverges meaningfully.
11. **Redis connection sharing with pubsub Publisher.** Publisher (`services/indexer/src/pubsub.rs`) already holds a `redis::aio::ConnectionManager`. Discovery should share it or hold its own? Default: share — single `Arc<ConnectionManager>` in `ApiState`, half the connection count to Redis, same reconnect semantics.

## Invariants

1. All response amounts use JSON strings for `u64`/`i64` fields (precision-safe for JS consumers).
2. All response timestamps are unix seconds as integers (matches on-chain `i64`).
3. All hex fields are lowercase + unprefixed (matches existing `stats.rs` + `api.rs` convention).
4. No endpoint writes to Postgres or Redis state other than invalidation `DEL` + cache `SET EX`.
5. WS delivery is at-most-once; consumers that need guaranteed delivery must reconcile via REST on reconnect.
6. Anonymous callers never see augmented fields; authenticated fields are omitted on anonymous responses, not nulled.
7. Cursor is opaque to clients and parseable only by the current schema version; a schema change invalidates all outstanding cursors.
8. Event-driven cache invalidation fires strictly after the corresponding `program_events` row commits (publisher ordering guarantee from cycle-55 reorg / cycle-57 pubsub).
9. Reads never touch RPC; chain-truth round-trips stay in the SDK.
10. Rate-limit buckets are per-endpoint-class, not per-path; a misbehaving caller on `/agents` doesn't starve `/tasks`.
11. WS authentication downgrade (anonymous subs allowed on `agents` + `capabilities` only) applies at subscribe-time; an auth-expiring socket mid-stream is disconnected, not silently downgraded.
12. Materialized views are the search substrate; `program_events` is the source of truth — a view-rebuild from scratch is always possible.

## Done checklist

- [ ] Spec reviewed by solana-indexer-engineer + frontend-engineer + maintainer.
- [ ] Migration `2026-04-17-000005_discovery_views` lands: `agent_directory` + `task_directory` materialized views + indexes + refresh job in `jobs/`.
- [ ] `services/indexer/src/api/discovery.rs` implements the 11 REST endpoints against the views + `program_events`.
- [ ] `services/indexer/src/api/discovery_ws.rs` implements the 4 WS channels with Redis pubsub bridge.
- [ ] Rate limiter lands (Rust port of IACP's `KeyedRateLimiter` or `tower_governor` per Open-Q #4).
- [ ] Prometheus metrics registered + scraped on `/metrics`.
- [ ] `@saep/sdk/discovery` submodule generated, `useAgentSearch` + `useTaskSearch` + `useAgentDetail` landed in `@saep/sdk-ui`.
- [ ] Portal `/marketplace` migrated from `useAllAgents` to `useAgentSearch`.
- [ ] Portal `/agents/[did]` migrated from client `fetchAgentByDid` + `fetchTasksByAgent` to `useAgentDetail` + `useAgentTasks`.
- [ ] Portal `/tasks` list migrated (frontend-engineer to build — not in scope for M1 marketplace-first landing).
- [ ] Vitest unit coverage: handlers 90%, SQL builders 100%.
- [ ] Integration test harness: hits real Postgres + Redis + mock Publisher; covers 12 endpoint × auth combinations.
- [ ] `/v1/discovery/ws` smoke test against localnet — subscribe to `tasks` channel, create task on-chain via SDK, receive event within 2s.
- [ ] Postgres `EXPLAIN ANALYZE` snapshots filed at `reports/discovery-query-plans.md` for every indexed query path.
- [ ] Rate-limit chaos test: 1000 concurrent connections, 16 subs each — verify fair-queueing + memory ceiling.
- [ ] Cache hit-rate reports weekly at `reports/discovery-cache-health.md` once prod traffic lands.
- [ ] Discovery API documented at `apps/docs/v1-discovery/` (auto-generated from zod schemas + handwritten WS protocol walkthrough).
- [ ] Neodyme M2 audit scope updated to include Discovery endpoints (cross-tenant leakage + rate-limit bypass threat classes) — cross-ref `docs/audit/neodyme-m2.md` once that scoping doc lands.
