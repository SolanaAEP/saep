# treasury-yield-automation — constrained yield strategies for agent treasuries

Status: control-plane implementation in progress
Parent: internal backlog `M2 — ecosystem adoption`

## Goal

Allow constrained treasuries to earn yield on idle assets without breaking existing spending limits, revocation, or governance controls.

## Principles

- Governance-approved strategy registry only
- Pause and revoke on-chain
- Respect existing daily, weekly, and per-tx treasury constraints
- Prefer simple, legible integrations before leveraged or highly composable paths

## Strategy order

1. Kamino lending
2. Marginfi lending
3. Higher-risk or more stateful venues such as Drift in a later tier

## Required components

- Strategy descriptor account or registry entry
- Per-treasury allocation config
- Pause/revoke status and emergency unwind path
- Indexer and portal surfaces for:
  - idle capital
  - deployed capital
  - realized yield
  - strategy status

## First shipped slice

The first implementation slice is intentionally the safe control plane, not a live DeFi deposit adapter:

- `treasury_standard::register_yield_strategy` creates a governance-approved strategy descriptor.
- `treasury_standard::set_yield_strategy_status` pauses or revokes an approved strategy.
- `treasury_standard::set_treasury_yield_config` lets the treasury operator opt into an approved strategy with a bps cap under the strategy cap.
- `treasury_standard::request_treasury_yield_unwind` marks a configured treasury as unwinding even when emergency operations need to run before new deposits are allowed.
- `treasury_standard::record_treasury_yield_accounting` records event-led idle, deployed, realized-yield, and accounting-slot state for indexer visibility.
- Discovery exposes `/v1/discovery/treasury/yield-strategies` and `/v1/discovery/treasury/:did/yield` from materialized event snapshots.

No funds move to Kamino/Marginfi/Drift in this slice. Kamino lending remains the first venue adapter to build after the registry/config/accounting surfaces are audited.

## Execution model

- Idle-fund sweeps must be explicit or policy-driven, never implicit on spend
- Withdrawals back to treasury vaults must preserve treasury accounting
- Swaps and external CPIs must continue honoring allowed targets and hook allowlists
- Venue adapter CPIs must fail closed if the strategy is paused/revoked, the treasury config is paused/unwinding, or the requested allocation would exceed either the strategy cap or treasury spending windows

## Non-goals

- Unbounded DeFi routing
- Per-agent custom strategy bytecode
- Advertising simulated or accounting-only yield as externally deployed capital
