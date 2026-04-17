# Post-launch optimization tickets

Parent: `backend-build.pdf` §6.1 ("Post-launch optimization").
Scope: performance / cost / operational work that is **not** a pre-audit blocker but should land on the M2→M3 ramp, once M1 is live on devnet and observability is pinning real numbers against the scaffold assumptions.

These tickets stay out of the M1 critical path because each one is either (a) premature without production-shaped traffic, (b) requires a feature not yet on mainnet (e.g. ZK compression with active indexers, SIMD-0228 scheduled tx), or (c) a tuning exercise that needs live CU/RPC/throughput telemetry to target correctly. The common thread: we can do the scaffolding work safely, but the *parameters* are unknowable until the protocol carries real flow.

Ordering is by unblock-sequence: CU tuning first (feeds every other cost model), ALT caching next (tx-size sibling of CU), Light Protocol compression third (account-count reduction — deepest change), Redis Streams backpressure last (off-chain only, independent track).

---

## 1. CU auto-tuning

**Why post-launch:** M1 ships with `cu-measurements.md` carrying per-instruction budgets from `anchor test` localnet runs + a ±30% headroom. Real mainnet CU varies with account-data size, bumpmap collisions, Jupiter route depth, and warm/cold PDA touch cost — none of which the localnet harness can reproduce faithfully. Locking budgets pre-freeze would either over-pay (wasted fee) or under-pay (prod tx rejection).

**Target:** ship a settlement-worker path that observes actual CU per instruction class over a rolling window and sets `ComputeBudgetProgram::set_compute_unit_limit` per tx to `p99 × 1.1`.

**Pieces:**
- **Telemetry.** Indexer already exposes `saep_indexer_poll_cycle_duration_seconds{program}` (cycle 58). Add `saep_tx_cu_consumed{program,ix}` sampled from `getTransaction(...).meta.computeUnitsConsumed` for every settled tx the worker submitted. Histogram buckets: `10k, 50k, 100k, 200k, 400k, 800k, 1.4M` (Solana's per-tx cap).
- **Rolling window store.** Redis sorted set per `(program, ix)`, last 1000 samples, eviction by insertion-index. Reads are lazy at build-tx time.
- **Tx builder integration.** `services/indexer/src/settlement_worker/tx_builder.rs` (already exists per cycle-92 git log) grows a `CuEstimator` field. Per-ix `set_compute_unit_limit` ix prepended from `estimator.p99(program, ix) * 1.1`. Floor: current `cu-measurements.md` budget (never go below the audit-measured number). Cap: 1.4M (Solana limit).
- **Priority-fee pairing.** Already handled by `@saep/sdk/submit/staked.ts::withPriorityFee` (cycle 66). CU-tuning changes `set_compute_unit_limit`, not `set_compute_unit_price` — they compose cleanly.
- **Cold-start fallback.** Fewer than 50 samples in window → use `cu-measurements.md` static budget. No autotune amplification from a tiny sample set.
- **Governance.** `cu_autotune_enabled: bool` in settlement-worker config, default off until telemetry accrues. Flipping to on is ops action, not governance vote — it's a tx-construction hint, not an on-chain parameter.

**Not in scope:** on-chain CU-aware routing (e.g. switching between two Jupiter routes based on estimated CU). That's a worker-side optimization layered on top once the primitive works.

**Acceptance:**
- Settlement worker emits tuned CU budgets within ±15% of the actually-consumed value for 90%+ of settled txs over a 7-day window.
- Fee spend on `set_compute_unit_limit` overhead (one ix per tx) is bounded by per-sig base fee × bundle size; measure and report.

---

## 2. Address Lookup Table caching

**Why post-launch:** ALTs reduce tx size for multi-account txs (settlement bundles touching escrow + vaults + Jupiter route accounts can hit 30+ account refs). M1 ships without ALTs because the bundle composition is still settling — ALT contents shouldn't drift mid-audit. Once the stable set of frequently-co-accessed accounts is known, ALTs cut tx-size pressure and unblock bigger bundles.

**Target:** settlement worker reads from a small set of ALTs (5-10) covering the hot accounts; ALTs refresh weekly without worker restart.

**Pieces:**
- **ALT inventory.** One ALT per "composition class": `settlement-core` (fee_collector vaults, market_global, proof_verifier config), `jupiter-hot` (Jupiter v6 route hotspots per the tip-oracle's top-10-routes telemetry), `token2022-hot` (SAEP mint + common operator ATAs), `iacp-anchor` (SPL-Memo program + IACP anchor PDAs).
- **ALT authority.** Dedicated PDA per ALT, derived from `fee_collector`'s authority (Squads 4-of-7) so ALT mutation is gated on the same quorum as fee-param changes. Address lookups are read-only at use-time; auth only matters for extend/freeze.
- **Refresh job.** Daily cron pulls current account-id list from the tip oracle + indexer stats, diffs against the committed ALT, emits `extend_lookup_table` ix for new entries. No delete at M2 — ALT entry removal requires ALT rotation (new table, not edit); defer to M3 unless churn is high.
- **Worker integration.** `tx_builder.rs` gains `alt_resolver: Arc<AltCache>`. Cache loads all ALTs at worker start, refreshes on a 15-minute tick (cheap RPC; ALT account is read-only-ish). `build_versioned_tx()` uses `MessageV0::try_compile(payer, ixs, &alts, blockhash)`.
- **Fallback.** ALT load failure → legacy-tx fallback, with a warning log. Never block settlement on ALT unavailability.
- **SDK side.** `@saep/sdk` exposes `getKnownAlts(): Pubkey[]` for frontend paths that want tx-size savings (e.g. quick-hire bundle in `/marketplace`). Frontend opt-in, not required.

**Not in scope:** dynamic ALT creation per user / per agent. Account count at M1 is too low for that to pay. If needed at scale, layer on top.

**Acceptance:**
- Settlement-worker bundles that would have exceeded the legacy 1232-byte tx limit now fit, measured pre/post switch.
- ALT entries cover ≥95% of account refs observed on settled txs over 7 days (miss-rate bounded).

---

## 3. Light Protocol badge compression

**Why post-launch:** Reputation badges + capability-proof receipts are account-per-agent data that scales linearly with agent count. At M1 each AgentAccount is ~400 bytes; at 100k agents the on-chain rent footprint is ~0.6 SOL/agent/epoch = hundreds of SOL in rent reserves. Light Protocol's ZK compression reduces the on-chain cost to a merkle-root commitment with off-chain state + ZK proof on access. **Not** a solve for the hot path (active agent PDAs stay uncompressed); compression is for the long tail — badges, historical reputation snapshots, retired agent accounts.

**Target:** `compressed_reputation` side-table per agent, reconstructible from the Light indexer, with on-chain merkle root in `RegistryConfig`. Read path: SDK pulls proof + leaf from Light's photon indexer, verifies against on-chain root.

**Pieces:**
- **Schema decision.** Which fields compress: historical reputation snapshots (6-axis scores per epoch), task-completion badges (capability bit × completion-count), retired agent archive. Active ReputationScore PDA stays uncompressed — it's the hot-path.
- **Light Protocol integration.** `programs/agent_registry` gains a `compress_historical` ix that reads the last N epochs of ReputationScore, packs them into a Light concurrent-merkle-tree leaf via Light's `account-compression` program CPI, and zeros the on-chain PDA (refundable rent → fee_collector's treasury bucket). CPI target: `SysvarC1ock11111111111111111111111111111111` + Light's compression program ID (pinned in `global.light_compression`).
- **Indexer.** Subscribe to Light's photon gRPC in addition to Yellowstone. Decompressed leaves land in a separate Postgres table `compressed_reputation` with the same shape as `reputation_rollup` + `merkle_leaf_index` + `tree_id` columns.
- **SDK read path.** `@saep/sdk/reputation/fetchHistory(did, epochRange)` branches: if epoch is within the last 12 epochs, read the uncompressed PDA; older, fetch from photon + verify proof against `RegistryConfig.historical_root`.
- **Audit footprint.** Adds a new cryptographic dependency (Light's merkle program + their prover). Halborn (M3 audit) needs to see the integration; scoping happens when Halborn engagement lands.

**Not in scope at M2:** task-market-side compression (tasks are short-lived; PDA close already recovers rent). Governance proposal archiving (separate concern). M3+ may revisit.

**Open question:** Light Protocol's programs aren't currently on devnet in a maintained form (confirmed via `light-protocol/light-protocol` repo activity — all of their deployments target mainnet-beta). Devnet rehearsal may require self-deploying Light's programs against a localnet, which is a multi-day task of its own. Flagged for reviewer — could defer to M3+ if the devnet path is too expensive.

**Acceptance:**
- On-chain rent for reputation history drops to ≤10% of the uncompressed equivalent at 100k simulated agents.
- SDK read-path p99 latency for historical reputation ≤200ms (photon + verify).

---

## 4. Redis Streams backpressure + consumer ACK

**Why post-launch:** IACP bus ships with Redis Streams (cycle 65 rate-limit + metrics) but the consumer-ack story is minimal — messages are published fire-and-forget, consumers read from `$` with no durable cursor, and there's no explicit backpressure path if the indexer's anchor-worker pool (cycle 64) falls behind. At M1 volume this is fine. At 100+ messages/sec sustained, publisher-side buffering + consumer-side lag become real.

**Target:** every Stream has a registered consumer group, ACKed reads, pending-entries-list monitoring, and a bounded-queue policy that either blocks publishers or drops old entries per-topic.

**Pieces:**
- **Consumer groups.** Every Stream gets a named group at publisher boot: `saep:events:<program>` → group `indexer-ingest`; `saep:task.*` → group `iacp-anchor-worker`. Groups created idempotently (XGROUP CREATE with MKSTREAM).
- **XREADGROUP instead of XREAD.** Consumers read with `XREADGROUP GROUP <name> <consumer-id> ... >` so each message is delivered once per group. Consumer-id = `{hostname}-{pid}-{service-version}` — stable across restarts for the same deploy, unique across concurrent workers.
- **XACK on success.** After the consumer finishes processing (e.g. `record_event` returns OK for the indexer), XACK the message. Pending entries list (PEL) holds unacked messages for the inspection path.
- **PEL monitoring.** `XPENDING GROUP <name>` on a 30-second tick → new metric `iacp_stream_pel_depth{stream,group}`. This was flagged "deferred" in cycle 65's rate-limiter landing; ship it here.
- **Lag metric.** `iacp_stream_lag_seconds{topic}` — already flagged deferred in cycle 65. Computes `now - earliest_pel_timestamp`. Grafana alert at 30s lag for task.* topics (settlement latency SLO).
- **Claim-stale-pending.** `XCLAIM` on entries pending > 5min → rebalance to a healthy consumer. Runs from the same cron tick as PEL monitoring.
- **MAXLEN bounds.** Every XADD uses `XADD <stream> MAXLEN ~ <N>` with per-stream `N`: `saep:events:*` = 100k (indexer ingest is steady-state), `task.*` = 10k (bounded by settlement velocity), `iacp.anchor.*` = 100k (anchor queue is slower than ingest). Approximate trim (`~`) for perf; exact trim only at shutdown.
- **Publisher backpressure.** When a publisher's target stream's MAXLEN is already reached AND the consumer lag metric exceeds threshold, new messages get a `503 BusCongested` response (REST) / `{type: "congested"}` WS-close (WS). Contrast with MAXLEN-only which silently drops old messages — backpressure surfaces the congestion to the caller so agent-side retry logic engages.
- **Replay.** Consumer groups enable replay: a new consumer joining `indexer-ingest` reads PEL first (unacked messages), then catches up from the group's delivery cursor. Handles indexer restart cleanly without reprocessing acked entries.

**Not in scope:** cross-region replication, durability SLA negotiation with Redis provider. Single-region Upstash/Render single-instance Redis is fine at M2 volume.

**Open question:** Redis Stream consumer-group semantics with Upstash's regional failover path are underspecified in their docs. If we pick Upstash for the RPC-proxy rate limiter (INBOX open item), revisit whether consumer-ack survives failover or if every failover reprocesses the PEL. Alternative: keep IACP Streams on a Render single-instance Redis and use Upstash only for stateless rate-limit counters.

**Acceptance:**
- Indexer restart replays PEL, processes all unacked entries, 0 ingest-layer dupes in `program_events` post-reprocess (idempotent on `(program, sig, slot, ix_index)` already).
- `iacp_stream_lag_seconds{topic="task.verified"}` p99 ≤ 5s at 50 msg/sec sustained.
- Publisher-side `503 BusCongested` rate matches synthetic-congestion load-test expectations; zero silent message loss past MAXLEN.

---

## Sequencing

```
M1 ship (devnet alpha)
    │
    ├─ observability baseline (week 1-2 post-launch)
    │   └─ saep_tx_cu_consumed histograms accrue
    │
    ├─ CU auto-tuning (#1) — needs 2 weeks of samples to tune
    │
    ├─ ALT caching (#2) — independent track, can start at week 1
    │
    ├─ Redis Streams backpressure (#4) — independent track, can start at week 1
    │
    └─ Light Protocol compression (#3) — M3+ candidate,
         blocked on Light devnet rehearsal decision
```

Items 1 + 2 + 4 are M2 candidates. Item 3 is M3+ pending the devnet-rehearsal answer.

## Open questions

- **Should the CU estimator live in the worker or as a shared `@saep/sdk/cu` module?** Frontend tx-builders could benefit from the same estimator, but serving it to the browser requires exposing per-ix histograms — possibly over the Discovery API (`specs/discovery-api.md`). Trade: code reuse vs surface-area-of-public-endpoints growth. Default: worker-local for M2, promote to SDK if frontend asks.
- **ALT authority: dedicated PDA vs reuse of `fee_collector` authority.** Spec proposes dedicated PDA (cleaner blast radius if ALT auth is ever rotated independently) but adds one more PDA class to track. Reviewer's call.
- **Light compression on devnet feasibility.** See §3 open question. If self-deploying Light's programs on localnet is too expensive, item 3 defers entirely to M3 trusted-setup window.
- **Redis Streams backpressure: congestion signal at REST vs protocol-level.** `503 BusCongested` is HTTP-level; an IACP-envelope-level `congested` code might be more semantic. Default: HTTP for REST, WS-close-code for WS, both documented in `specs/08-iacp-bus.md` when this lands.
- **Who runs the CU-telemetry cron:** indexer (knows settled txs) vs settlement-worker (knows intended budget). Indexer is simpler (already has `getTransaction` path); worker gets a smaller feedback loop. Default: indexer, because the settlement-worker path already depends on indexer signals for IACP-subscribed settlement triggers.

## Cross-references

- `specs/indexer-schema.md` — `saep_tx_cu_consumed` lands alongside existing histograms in §Metrics.
- `specs/08-iacp-bus.md` — MAXLEN + consumer-group policy per topic.
- `specs/discovery-api.md` — CU estimator as possible future public endpoint.
- `specs/mev-settlement.md` — ALT-composed bundles as the shipping path for multi-ix bundles.
- `backend-build.pdf` §6.1 — original scope.
- `reports/cu-measurements.md` — static CU budgets that serve as the autotune floor.
