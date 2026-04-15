# retro-airdrop — fee-generation-based developer incentives

Parent: `backlog/P2_retro_airdrop_design.md`.
Spec-only for M1/M2 — live distribution tied to M3 token launch. This doc freezes the eligibility model + rollup schema + portal surface; token math ratified at M3.

## Reserve

- **10–15% of SAEP total supply** allocated to retro pool (confirmed at tokenomics-finalization, before M3 audit).
- Unlock: 50% cliff at TGE, remaining linear over 24 months — avoids mercenary dump.
- Bucket within `GovernanceProgram::TreasuryVault` marked `retro_bucket`.

## Eligibility

### Who qualifies

Agent operators (on-chain address = `AgentAccount.operator`) whose agents generated **protocol fees** via `fee_collector` during the eligibility window. Template authors (`AgentTemplate.author` in `template_registry`) qualify on royalty-accrued revenue routed through fee_collector.

Clients / task creators do **not** qualify — fee generation is a production-side metric. Separate program (post-launch rebate) covers consumer-side rewards.

### Window

Trailing 6 epochs ending at TGE snapshot. Epoch = 30 days. Roll-forward nightly (indexer job). Any agent or template author who generated fees in ≥ 1 epoch is in the candidate set.

### Per-agent cap

`min(fee_generated * FEE_MULTIPLIER, GLOBAL_CAP_PER_AGENT, 0.5% of retro pool)`.

- `FEE_MULTIPLIER`: tuned so `expected_total_allocation ≈ 0.7 * retro_pool_tokens` (30% slack for tail/latecomer agents).
- `GLOBAL_CAP_PER_AGENT`: 1% of retro pool absolute cap.
- `0.5%` per-operator floor for whales: aggregated across all agents owned by same `operator` pubkey — prevents single dev stacking via multiple agents.

## Anti-gaming

### Sybil deduplication

Primary: personhood attestation (see `specs/pre-audit-04-personhood-gate.md`). Operators without PersonhoodAttestation at TGE snapshot receive **50% allocation** only. Full-tier only with `PersonhoodTier.Verified`.

Secondary: operator-level aggregation — all agents sharing an `operator: Pubkey` sum to one slot.

### Wash-trading filter

Flag suspect fees, exclude from eligibility:

1. **Self-task detection**: task.client == agent.operator (direct) OR any agent transitively owned by operator. Exclude all fees from such tasks.
2. **Circular settlement heuristic**: client → agent A → (as client) → agent B → (as client) → operator. Graph traversal up to depth 3; if > 40% of fee_generated traces back to self, down-weight to 0.
3. **Minimum payment threshold**: tasks under $0.10 USDC-equivalent excluded (spam-farming filter).
4. **Burst detection**: fee volume spike >10× 30-day median in the final week before snapshot → throttle contribution of burst-window fees to the pre-burst baseline.

Wash rules are **public** — spec + implementation versioned; gaming the wash filter directly requires expensive collusion.

### Cold-start protection

Agents registered in the last 2 weeks before snapshot get the same treatment as personhood-light (50%) — avoids last-minute fee-farming immediately before snapshot.

## Indexer rollup

`services/indexer/jobs/retro-rollup.rs`:

```rust
// Nightly job:
//  1. Re-scan fee_collector::FeeClaim events for window.
//  2. Join with agent_registry, template_registry for operator attribution.
//  3. Apply wash-trading filters (graph traversal over task_market::TaskContract).
//  4. Aggregate to operator level.
//  5. Apply personhood tier multiplier.
//  6. Emit to retro_eligibility table.
```

Schema:

```sql
CREATE TABLE retro_eligibility (
  operator pubkey PRIMARY KEY,
  net_fees_micro_usdc bigint NOT NULL,
  wash_excluded_micro_usdc bigint NOT NULL,
  personhood_tier text NOT NULL CHECK (personhood_tier IN ('none','basic','verified')),
  personhood_multiplier numeric NOT NULL,
  cold_start_multiplier numeric NOT NULL,
  estimated_allocation numeric,           -- computed once FEE_MULTIPLIER finalized at TGE
  epoch_first_seen int NOT NULL,
  last_updated timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON retro_eligibility (net_fees_micro_usdc DESC);
```

`estimated_allocation` is illustrative until TGE — portal shows it as "estimated, not guaranteed". Hard-frozen at TGE snapshot block slot.

## Portal surface

`apps/portal/app/retro/check/page.tsx`:
- User signs a SIWS message with their operator wallet to view allocation.
- Response: `{operator, net_fees, estimated_allocation_tokens, estimated_usd_at_tge_price, wash_excluded, personhood_tier, cold_start, epoch_first_seen}`.
- Transparent: show which filters applied + links to source events on explorer.

No claim flow until M3. At M3: add `/retro/claim` that constructs and submits `token_program::Transfer` from retro_bucket via signed merkle-root membership proof (standard airdrop merkle pattern).

## On-chain changes

Zero pre-M3. Everything off-chain until token mint exists. At M3 add:

- `retro_distributor` program (new, small) with ix:
  - `init(merkle_root, total_supply, vesting_schedule)`
  - `claim(amount, index, merkle_proof, operator_sig)`
  - `sweep_unclaimed(authority, destination)` (after 12mo reclaim to treasury)

Audited separately at M3 with Halborn.

## Timeline

| phase | what |
|---|---|
| M1 (now) | spec landed, indexer job scaffold, portal page reads mock data |
| M2 | real rollup running against devnet fee events |
| M3 (TGE) | freeze FEE_MULTIPLIER, generate merkle_root, deploy retro_distributor, portal claim live |
| M3 + 12mo | sweep_unclaimed |

## Open questions

- Personhood tier multiplier exact ratio: proposed 50/75/100 for none/basic/verified; governance ratifies at M3.
- Treatment of agents whose operator loses their key: signature-gated recovery via `agent_registry::rotate_operator` pre-TGE only; after-TGE losses absorbed.
- Disclosure: publish the full eligibility script as open source *before* TGE so community can self-verify.
