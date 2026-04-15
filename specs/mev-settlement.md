# MEV / Jito settlement policy

Parent: `backlog/P0_pre_audit_hardening.md` item 6.
Threat: task settlement txs (`release`, `resolve_dispute`, `close_bidding`) contain value-moving side effects public mempool-observers can frontrun or sandwich — e.g., sandwich the Jupiter swap inside `treasury_standard::stream_withdraw`, or frontrun `close_bidding` with a synthetic commit/reveal pair.

Pure on-chain defenses are limited (oracle slippage caps already land in `treasury_standard`). What's left is submission path: send settlement txs through Jito block-engine as bundles, with tip-based priority, so the mempool never sees them.

## Scope

- **Not** a program change. No `.rs` diffs here.
- Lives in `services/indexer` settlement worker + `packages/sdk` wallet adapters used by `apps/portal`.
- OtterSec scope: confirm on-chain code is bundle-compositional (no assumptions about tx ordering within a bundle that require trust in leader).

## Affected ix — always-bundle

| ix | who submits | bundle with |
|---|---|---|
| `task_market::release` | crank worker | fee_collector::collect_fee in same bundle |
| `task_market::close_bidding` | crank worker | refund all losing bond-claims in same bundle |
| `treasury_standard::swap_via_jupiter` | operator or crank | jupiter route instruction + slippage check |
| `dispute_arbitration::resolve` | arbiter | any slashing + fee routing |
| `task_market::submit_result` | agent operator | proof_verifier verify + agent_registry::update_reputation |

## Affected ix — bundle optional (cheap path acceptable)

- `task_market::create_task`, `fund_task`, `commit_bid`, `reveal_bid`: not value-extractive to outside parties pre-settlement; plain RPC fine. Agents may opt into Jito for their own protection against orderbook scrapers but not required.

## Worker architecture

`services/indexer/settlement-worker/`:
```
- tx_builder.rs      (builds the atomic instruction bundle)
- jito_client.rs     (submits to block-engine; fallback to plain RPC on bundle rejection)
- tip_oracle.rs      (pulls Jito tip floor; adds 20% headroom; caps absolute lamports/tip)
- nonce_accounts.rs  (durable nonce per worker to survive leader rotation)
```

Bundles submitted via [Jito block-engine REST](https://jito-labs.gitbook.io/mev/searcher-resources/block-engine) `sendBundle` — up to 5 txs, all-or-nothing.

### Tip policy

- Target: 50th percentile of observed tips for recent slots × 1.2 (headroom).
- Floor: 1000 lamports (avoid zero-tip rejections).
- Cap: 1% of the task payment amount (bound settlement cost).
- Tip account: Jito's rotating tip PDAs — we don't hold one.
- Log every submission: `{bundle_id, tip_lamports, target_slot, txs: [...]}` to indexer.

### Fallback

- Bundle rejected (e.g., block-engine 429 / slot miss): retry same bundle twice.
- After 2 failures: fall back to plain RPC submission via Helius, warn-logged with reason. Fallback only permitted for non-swap ix (swap must stay bundled or abort, to avoid sandwich).
- Permanent failure: emit `SettlementStuck` metric + alert. Human review.

## Durable nonce

Each settlement worker holds a `DurableNonce` account so bundles survive slot leader rotation. Recycle per hour or per 100 txs, whichever first.

## Composition invariants (on-chain code must honor)

The one on-chain rule: every settlement ix must be composable with siblings in a bundle. Concrete:

1. No reliance on `Clock.slot` for ordering within a bundle (we might be one of several bundles in the block).
2. `submit_result` + `update_reputation` CPI must both succeed in one tx OR neither — already the case since both are same-tx CPI.
3. No "pull current leader" ix assumptions — bundles hit any leader.
4. Idempotent-on-failure where possible: if `release` fails mid-bundle, escrow still withdrawable via `refund` path. Audit confirms.

Auditor diffs to look at: any place that reads slot/leader and branches — there should be none in settlement flows.

## IACP signal

Workers subscribe to IACP bus topics:
- `task.verified` → schedule release bundle.
- `task.disputed` → pause release until dispute resolution event.
- `bid.reveal_ended` → schedule close_bidding bundle.

Subscription-driven ensures no polling load on RPC.

## Verify

- Staging: run worker against devnet, confirm bundle submission returns `bundleId`, confirm landed via `getInflightBundleStatus`.
- Unit tests for `tip_oracle` floor/cap/headroom math.
- Integration: a sandwich attempt on devnet swap (send large commit-range order first) → post-bundle price within slippage bound, attacker does not profit.

## Open questions

- Jito restaking / regionality: pick region closest to Helius RPC. Default: NY. Tune post-M1.
- If Jito downtime is multi-hour, do we halt settlement or degrade to plain RPC? Proposed policy: halt value-movement ix (release, swap); continue metadata ix (close_bidding with no settlement, commit/reveal). Governance flag `settlement_require_bundle: bool`.
- When SIMD-0228 (scheduled tx) lands, revisit: may let us embed timing constraints directly rather than via bundle.
