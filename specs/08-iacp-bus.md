# Spec 08 — IACP (Inter-Agent Communication Protocol) Bus

**Owner:** scaffolder (off-chain services)
**Depends on:** 03 (AgentRegistry — signer/DID resolution)
**Blocks:** M2 portal chat surfaces, task-event push to frontends, agent↔agent coordination flows
**References:** backend PDF §3 (off-chain infra), §5.2 (service hardening), frontend PDF §4.3 (realtime websocket expectations)

## Goal

An off-chain message bus that lets registered agents and portal clients exchange signed messages, subscribe to task/system events, and relay notifications. It is the realtime layer that sits beside the Rust indexer: the indexer writes authoritative task state from chain events; IACP fans out transient messages and lets agents talk to each other without burning CU.

M1 ships the scaffold so other services (portal WS, proof-gen job updates, agent↔agent job negotiation) have a stable transport. No economic value flows through IACP itself — it carries intent and notifications, never authority.

## Non-goals (M1)

- No end-to-end encryption. Payloads are plaintext (or opaque bytes the sender already encrypted). E2E is a M2+ add-on pending the KMS design.
- No cross-chain relay. IACP is single-cluster, single-region.
- No message ordering guarantees across topics. Per-topic ordering is what Redis Streams gives us.
- No on-chain settlement or dispute hook — use TaskMarket for that.
- No federation across multiple IACP deployments.

## Transport

**Redis Streams** as the durable substrate:

- Each topic is one stream key. Messages are appended with `XADD <topic> * <field> <value> ...`.
- Consumer groups (`XGROUP CREATE`) give at-least-once delivery with explicit `XACK`.
- `MAXLEN ~` trim keeps each stream bounded (target 7-day window; see Retention).

**WebSocket gateway** (Fastify + `ws`) terminates client connections:

- Clients authenticate once on upgrade with a SIWS-issued session ticket.
- After auth, clients `SUB <topic>` / `UNSUB <topic>` over the WS control channel.
- Server maintains per-socket topic set; demultiplexes `XREADGROUP` results to matching sockets.

**HTTP control plane** (Fastify) exposes:

- `POST /publish` — authenticated publish for server-to-server jobs (proof-gen emits `task.<id>.events`).
- `GET /healthz`, `GET /readyz`.
- `POST /admin/trim` — operator-only stream trim.

Why Redis Streams over NATS/Kafka: already in our stack for indexer pubsub and Render managed, single ops surface. NATS JetStream is a reasonable alternative if we hit scale ceilings; the envelope is transport-agnostic.

## Message envelope

```ts
{
  id: string,              // ULID, unique per publish, also the XADD entry id prefix
  topic: string,           // see Topics
  from_agent: string,      // base58 agent pubkey from agent_registry
  to_agent: string | null, // base58 pubkey for direct, null for topic broadcasts
  payload_cid: string,     // IPFS CID of the payload blob; small payloads may inline via data: URI
  payload_digest: string,  // blake3 hex of the payload bytes
  signature: string,       // base58 ed25519 signature over canonical(envelope minus signature)
  ts: number               // unix ms, server-authoritative on ingest
}
```

Canonicalization for signing: JSON with keys in the order above, no whitespace, `signature` field omitted. Agents sign the canonical form with their operator key; server verifies against `agent_registry.operator_pubkey`.

Large payloads (>4 KiB) must be pinned to IPFS first; the envelope references by CID. `payload_digest` lets a consumer verify the blob it retrieves matches what the sender signed.

## Topics

| Pattern | Producer | Consumers | Purpose |
|---|---|---|---|
| `agent.<agent_pubkey>.inbox` | any authenticated sender | the owning agent | DM-style direct delivery |
| `task.<task_id>.events` | TaskMarket indexer, proof-gen | client portal, assigned agent, watchers | lifecycle events mirrored from chain + off-chain progress |
| `broadcast.<cap_tag>` | agents with that capability | agents subscribing to the cap | capability-gated broadcasts (e.g. `broadcast.zk-proof` for proof-gen job offers) |
| `system.<type>` | service ops | all clients | deploys, rate-limit notices, upgrades |

Rationale: the prefix is always the partition key, so a single consumer group can scale by sharding on prefix without reshuffling message IDs. Wildcard subscription (`agent.*.inbox`) is server-side denied — clients subscribe to their own inbox or a specific task/cap.

## Authentication and authorization

1. Client GETs `/auth/challenge?pubkey=<base58>` — server returns a nonce.
2. Client signs `saep-iacp:<nonce>:<ts>` via SIWS (Sign-In With Solana, CAIP-122).
3. Client POSTs `/auth/verify` with the signed message; server validates against the agent's on-chain operator key and issues a short-lived (15 min) session token (HS256 JWT, rotated via refresh).
4. WS upgrade carries the token in `Sec-WebSocket-Protocol` or `?token=`.

Authorization checks on every publish:

- `from_agent` matches the session's agent pubkey.
- `signature` verifies over the canonical envelope with the agent's operator key.
- If `topic == agent.X.inbox`, any authenticated agent may publish. Rate-limited per `from_agent` to prevent spam.
- If `topic == task.<id>.events`, only the task's client, assigned agent, or a service role may publish; read is open to participants.
- If `topic == broadcast.<cap>`, publisher must be registered with that capability in CapabilityRegistry.
- `system.*` is server-only (service role token).

Stubs in M1: none in the auth path. SIWS session auth, envelope ed25519 verify, agent_registry Active-operator gating, and envelope `ts` freshness window (default 5min age, 30s clock-skew) are all live.

## Delivery semantics

- **At-least-once.** Consumer groups hold pending entries until `XACK`. A consumer that crashes mid-process will see the entry again on restart via `XREADGROUP ... 0` / `XPENDING` reclaim.
- **Idempotency.** Every envelope has a ULID `id`. Consumers keep a bounded dedup cache (Redis SET with `EXPIRE`) for 24h — long enough to absorb redelivery storms without unbounded memory. Duplicate `id` from the same `from_agent` in the dedup window is a hard reject.
- **Ordering.** Per-topic (per-stream) ordering is preserved by Redis; cross-topic ordering is not guaranteed and clients must not depend on it.
- **Fanout.** Topic subscribers within a single IACP node receive via in-memory subscriber registry. Multi-node fanout uses a shared consumer group per node so each message lands on exactly one node-local dispatcher, which then broadcasts to its own WS subscribers.

## Retention and archival

- Streams are trimmed with `XADD ... MAXLEN ~ <N>` where `N` is sized for 7 days at p95 topic throughput. Per-topic override via config.
- A background sweeper scans streams older than 7 days and pushes to IPFS via `IPFS-ARCHIVE-STUB`, then `XTRIM MINID`.
- Archive CID index is written to Postgres (`iacp_archives(topic, first_id, last_id, cid, archived_at)`) so historical replay is possible without hot-storage cost.

## On-chain anchoring (memo worker pool)

Every successfully published envelope whose topic starts with `task.` is fanned out to an in-process worker pool that emits an SPL-Memo v2 transaction (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`). The memo payload is `saep/iacp/v1/<sha256(id|payload_digest|ts)>` — deterministic on envelope identity, not on opaque payload bytes. Indexers can prove inclusion by recomputing the hash from the envelope fields.

Design points:

- **Best-effort, decoupled.** The anchor enqueue is a synchronous no-op fire-and-forget after `bus.publish` returns. Anchoring failure never rejects a publish; envelopes remain in the Redis stream regardless of on-chain outcome.
- **Filter.** Only `task.*` topics are anchored. Agent inboxes (`agent.*`) and broadcasts are intentionally skipped — they don't correspond to protocol state transitions. `skipped` is counted separately from `dropped` so ops can tell filtering from backpressure.
- **Backpressure.** The pool runs `IACP_ANCHOR_WORKERS` concurrent submissions (default 2) behind a bounded FIFO queue of `IACP_ANCHOR_QUEUE_CAP` entries (default 1024). Over-cap enqueues return `dropped_full` and increment `iacp_anchor_dropped_total{reason="queue_full"}`. No unbounded growth under RPC incident.
- **Retry.** Each submission gets up to `IACP_ANCHOR_MAX_RETRIES` attempts (default 3) with exponential backoff starting at `IACP_ANCHOR_BASE_RETRY_MS` (default 500ms). On exhaustion, the envelope is dropped from the anchor pipeline (still archived in Redis); `iacp_anchor_failed_total{reason="max_retries"}` increments.
- **Priority fees.** Optional `IACP_ANCHOR_PRIORITY_FEE_MICROLAMPORTS` prepends a `ComputeBudgetProgram.setComputeUnitPrice` ix; default 0 keeps base fee. Memo is ~5k CU; priority is off unless the mempool is hot.
- **Disabled by default.** Requires `IACP_ANCHOR_ENABLED=true` plus `IACP_ANCHOR_RPC_URL` (or `SOLANA_RPC_URL`) plus `IACP_ANCHOR_WALLET_PATH` pointing at a 64-byte secret-key JSON. Missing or invalid inputs log a warning and disable anchoring; service still starts.

Metrics exported: `iacp_anchor_enqueued_total`, `iacp_anchor_submitted_total`, `iacp_anchor_retried_total`, `iacp_anchor_failed_total{reason}`, `iacp_anchor_skipped_total{topic}`, `iacp_anchor_dropped_total{reason}`, `iacp_anchor_queue_depth`, `iacp_anchor_submit_duration_seconds`.

## Backpressure

- Per-socket send queue has a hard cap (default 256 messages). When full, the server drops the slowest consumer with a `1009` close code and logs `iacp.backpressure.drop`. The consumer may reconnect and resume from its last-known `id` via `XREADGROUP ... <last_id>`.
- Publish rate limit per agent: token-bucket (default 20/s burst, 5/s sustained). Over-limit publishes return `429` on the HTTP plane, `{type: "rate_limit"}` control frame on WS.
- Redis connection loss triggers circuit-breaker: the gateway returns 503 on publish, keeps existing sockets open for read, and resumes `XREADGROUP` on reconnect.

## Failure modes

| Failure | Detection | Response |
|---|---|---|
| Redis unreachable | ioredis `error` + health check | `/readyz` flips red; HTTP publishes 503; WS keeps socket, queues nothing |
| Consumer lag > threshold | `XPENDING` length check | pager alert, auto-claim to healthy consumer after 30s |
| Signature verify fail | per-publish | reject with `{type: "reject", reason: "bad_sig"}`, do not write stream |
| Unknown from_agent | registry lookup miss | reject, increment `iacp.unknown_agent` counter |
| Payload CID not resolvable | consumer-side | consumer logs, ACKs anyway to unblock group; UI shows "payload unavailable" |
| Slow consumer | send-queue overflow | drop socket; client reconnects and resumes by id |

## Compute budget notes

None. Fully off-chain. IACP never CPIs or consumes Solana compute. The only on-chain coupling is the AgentRegistry read for authentication, which is cached with a short TTL.

## Observability

- Pino JSON logs with request-id correlation across HTTP and WS.
- Prometheus metrics on `/metrics` (live): `iacp_publish_total{topic,result}`, `iacp_publish_duration_seconds{topic,path}`, `iacp_rate_limited_total{axis,path}`, `iacp_envelope_rejected_total{reason,path}`, `iacp_ws_connections`, `iacp_topic_subscribers{topic}`, `iacp_rate_limiter_buckets{scope}`, `iacp_anchor_enqueued_total`, `iacp_anchor_submitted_total`, `iacp_anchor_retried_total`, `iacp_anchor_failed_total{reason}`, `iacp_anchor_skipped_total{topic}`, `iacp_anchor_dropped_total{reason}`, `iacp_anchor_queue_depth`, `iacp_anchor_submit_duration_seconds`, plus `iacp_process_*` / `iacp_nodejs_*` from the prom-client default collector. Agent label was dropped from `iacp_rate_limited_total` — 32-byte pubkey cardinality is unbounded; path+axis is the alerting surface. `iacp_stream_lag_seconds{topic}` remains TODO (requires `XPENDING`/`XINFO GROUPS` sampling; next IACP cycle).
- Sentry for uncaught errors (tag: `service=iacp`).

## Open questions for reviewer

- Session token lifetime (15 min vs 1 h). Shorter is safer, longer is kinder to mobile agents with flaky links.
- Per-topic ACL config: static file vs on-chain CapabilityRegistry read per publish. M1 defaults to cached read; reviewer may want stricter live-check.
- Archive cadence: 7 days is the spec default; if portals rarely replay >24h, we can drop to 3 days and save Redis memory.
- Whether to expose a SSE fallback for clients behind WS-hostile proxies. Deferred unless we see demand.

## Done-checklist

- [ ] Spec matches implementation; envelope field names identical in code and doc
- [ ] `pnpm --filter @saep/iacp typecheck` green
- [ ] Local Redis run doc in README works from a clean checkout
- [ ] SIWS, agent-registry, signature-verify, IPFS-archive stubs clearly marked and tracked as M2 follow-ups
- [ ] Backpressure behavior demonstrated with a load-test harness
- [ ] Metrics exported on `/metrics`; Sentry wired via env
- [ ] Audit: no publish path bypasses signature verification
- [ ] Audit: no topic pattern allows cross-agent inbox reads
- [ ] Reviewer gate green before M2 portal starts depending on IACP
