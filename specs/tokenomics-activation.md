# Spec — SAEP Tokenomics Activation

**Status:** spec for the protocol-side economy wrapping the live SAEP mint.
**Mint:** see [`token2022-saep-mint.md`](./token2022-saep-mint.md).
**Programs in scope:** `fee_collector`, `nxs_staking`, `treasury_standard`, `task_market`, `governance_program`, `template_registry`, `retro_distributor` (when scaffolded).

## Goal

Define how value flows through the SAEP protocol when the mint itself carries no transfer-time hooks — the economy is CPI-driven across the program set, and this spec is the public record of the architecture.

## Why CPI-driven

The live SAEP mint is fully renounced and has no `TransferHook`, `TransferFee`, `PermanentDelegate`, `InterestBearing`, or `Pausable` extensions (see `token2022-saep-mint.md`). Pump.fun-style mints publish that posture deliberately. Rather than treat the absence as a defect, the protocol economy is wired entirely at program boundaries:

- Fees are captured at **task-settlement time**, not transfer time
- Staker rewards are **distributed** from a vault, not rebased on the mint
- Burns are executed via standard `burn_checked` against a protocol-held balance
- Retro and incentive payouts use `treasury_standard` streaming claims

This is the same design pattern most Solana protocols converge on regardless of mint extension support.

## Value flow overview

```
              ┌─────────────────────────────────────────────────┐
              │                  task_market                    │
              │  release: payment_amount = agent_payout         │
              │           + protocol_fee   ──────┐              │
              │           + solrep_fee     ──────┼──┐           │
              └──────────────────────────────────┼──┼───────────┘
                                                 │  │
                          ┌──────────────────────┘  │
                          ▼                         ▼
                ┌────────────────┐           ┌────────────────┐
                │ fee_collector  │           │  solrep pool   │
                │ EpochAccount   │           │   (treasury)   │
                │  total_collect │           └────────────────┘
                └───────┬────────┘
                        │ commit_distribution (per-epoch)
                        ▼
        ┌────────────────────────────────────────────┐
        │  StakerClaim PDAs (per staker, per epoch)  │
        └───────┬────────────────────┬───────────────┘
                │ claim_staker        │ execute_burn (buyback path)
                ▼                     ▼
        ┌──────────────┐      ┌──────────────────────┐
        │   stakers    │      │  burn (supply down)  │
        └──────────────┘      └──────────────────────┘
```

## Fee capture — `task_market::release`

When a task is verified and the dispute window expires, `task_market::release` splits `payment_amount` three ways before transfer:

1. **`agent_payout`** → agent's operator wallet (the bulk of the payment).
2. **`protocol_fee`** = `payment_amount * MarketGlobal.protocol_fee_bps / 10_000`. CPI-transferred to a `fee_collector` intake account.
3. **`solrep_fee`** = `payment_amount * MarketGlobal.solrep_fee_bps / 10_000`. CPI-transferred to a `solrep_pool` ATA.

The `fee_collector::record_intake` ix is the entrypoint — it is invoked by `task_market` (a registered slasher / fee source per `FeeCollectorConfig`) and adds the amount to the open `EpochAccount.total_collected`. No mint extension required.

`fee_collector` also accepts CPI fees from:
- `nxs_staking` (slash receipts on operator misbehaviour)
- `agent_registry` (collateral forfeits on `slash_agent`)
- `dispute_arbitration` (dispute resolution penalties)
- `governance_program` (governance-routed allocations)

Each path uses the same `record_intake` family (`slash_handler`, `forfeit_handler`) gated on the caller program's pubkey matching a registered slasher in `FeeCollectorConfig`.

## Distribution — `fee_collector::commit_distribution` → `nxs_staking::claim_staker`

When an epoch closes (`process_epoch` after `epoch_seconds + grace_seconds` have passed):

1. `EpochAccount.status` transitions from `Open` to `ReadyToCommit`.
2. `commit_distribution` is called by anyone (gas paid by caller, no privilege required) and:
   - Reads `EpochAccount.total_collected`.
   - Splits per `FeeCollectorConfig.distribution_split_bps` (rewards bucket) vs `burn_split_bps` (burn bucket).
   - Allocates the rewards bucket across staker shares from `nxs_staking::Pool.total_staked` snapshot at epoch close.
   - Creates one `StakerClaim` PDA per eligible staker with `(epoch_id, staker_pubkey, amount)`.
3. Each staker calls `claim_staker` to drain their `StakerClaim` PDA into their ATA. PDA closes on claim, rent refunded.

Stakers see APY as a derived metric — not a native rebase but real distribution per epoch.

## Burn — `fee_collector::execute_burn`

Two paths feed the burn bucket:

### Direct burn from fee revenue

`commit_distribution` allocates `burn_split_bps / 10_000` of `total_collected` to the burn bucket. If the bucket holds SAEP directly (e.g., from a Token-2022 SAEP-denominated fee path), `execute_burn` is called with a SAEP source account and burns it via `burn_checked`.

### Buyback-then-burn (primary path for USDC fees)

Most fees accrue in USDC (`payment_amount` is typically USDC). The `services/buyback-bot/` worker (deployed separately):

1. Reads the USDC balance of the FeeCollector PDA's USDC vault.
2. If above a configurable threshold (e.g., $50), routes the full balance through Jupiter v6 to swap USDC → SAEP. Slippage capped at 200 bps.
3. Calls `fee_collector::execute_burn` with the SAEP balance just acquired.
4. Publishes `BurnExecuted { epoch_id, amount, signature }`.

The buyback bot's keypair is restricted: it can call `execute_burn` and Jupiter-swap on its own ATAs only. No general SAEP transfer authority. No SAEP custody beyond the in-flight swap.

## Staking — `nxs_staking`

- Stake mint: SAEP (`HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump`).
- Pool reward authority: FeeCollector PDA. Distributes through `commit_distribution`.
- Lockup: minimum 7 days at launch, raised by governance once a stable staker base exists.
- Slash authority: `governance_program`. Only on operator misbehaviour, ratified by 6-of-9.
- APY: surfaced on the portal `/staking` page as `last_epoch_distribution / total_staked` — a real moving number derived from on-chain state, not a configured rate.

## Retro distribution — `retro_distributor`

Per [`retro-airdrop.md`](./retro-airdrop.md):

- 10–15% of supply allocated to a retro pool (TGE-snapshot, governance-funded from a treasury allocation).
- Trailing 6-epoch eligibility window.
- Operators with `PersonhoodAttestation::Verified` claim 100%; without, 50%.
- Wash filter (self-task, circular settlement, burst, min-payment) excludes suspect fees.
- Claim flow: 50% cliff at TGE, 50% via a `treasury_standard::PaymentStream` linear over 24 months.

The `retro_distributor` program is the on-chain claim ix; the eligibility table is materialised by the indexer (`retro_rollup` job consuming `fee_collector::SlashReceived` + intake events). Public claim surface lives at `/retro/check` on the portal.

## Governance authority surface

- `MarketGlobal` parameters (fee bps, deadlines, mint allowlist): governance 6-of-9.
- `FeeCollectorConfig` parameters (epoch length, splits, registered slashers): governance 6-of-9.
- `nxs_staking::Pool` parameters (lockup, slash threshold): governance 6-of-9.
- Emergency pause on dependent programs (`fee_collector::set_paused`, `task_market::pause`): ratified by emergency authority surface (smaller threshold, separate signer set per `ops-squads-multisig.md`).
- Treasury allocations from `governance_program::TreasuryVault` (retro pool, bounty pool): 6-of-9.

## What's *not* possible (vs the original aspirational design)

| Aspirational lever | Live posture |
|---|---|
| Halt all SAEP transfers in an incident | Not possible — no `Pausable` on mint. Programs pause; secondary trading continues. |
| Apply 10 bps fee on every transfer regardless of context | Not possible — settlement-time fees only. |
| Reclaim lost / stolen SAEP via PermanentDelegate | Not possible — fully renounced. |
| Show stakers a native rebase number | Not possible — APY is computed from realised distributions. |
| Block specific addresses from holding SAEP | Not possible — no freeze authority. |

These are protocol-level constraints, documented openly. Holders should know what the mint does and does not enforce.

## Public verification

Anyone can independently verify the protocol-side flow:

- `MarketGlobal` config: read on-chain, matches portal display.
- `FeeCollectorConfig` parameters: read on-chain.
- `EpochAccount` history: queryable via discovery (`/v1/discovery/fee-epochs` once wired) or directly via RPC.
- `BurnExecuted` events: indexed; cumulative supply burn surfaced on the portal `/tokenomics` page.
- `StakerClaim` distributions: per-staker, per-epoch, on-chain.
- Retro eligibility table: indexer matview, public read.

## Activation sequencing

This spec describes the architecture once activated. The activation order is captured in the substitute-package security work plus a separate sprint plan (not in this repo) and is gated on the security-review and bounty-pool prerequisites being live.

Roughly:

1. `fee_collector::init_config` via 6-of-9 — sets epoch length, splits, registered slashers.
2. `nxs_staking::init_pool` — establishes the SAEP staking pool.
3. Buyback bot deploy — daily USDC → SAEP → burn.
4. Retro distribution — TGE snapshot, pool funded, claim flow live.
5. `/tokenomics` portal page rewritten to surface live values.

## Out of scope (this spec)

- Cross-chain SAEP (LayerZero / Wormhole) — separate spec, future work.
- ZK proofs of buyback authenticity — overkill at this scale.
- Pre-launch tokenomics governance (the mint is already launched; this spec describes operating economy, not launch ceremony).
- Re-mint to a fully-extended Token-2022 token — explicitly rejected; community sentiment + liquidity tied to v1.
