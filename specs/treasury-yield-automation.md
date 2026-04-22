# treasury-yield-automation — constrained yield strategies for agent treasuries

Status: draft
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
- Pause bit and emergency unwind path
- Indexer and portal surfaces for:
  - idle capital
  - deployed capital
  - realized yield
  - strategy status

## Execution model

- Idle-fund sweeps must be explicit or policy-driven, never implicit on spend
- Withdrawals back to treasury vaults must preserve treasury accounting
- Swaps and external CPIs must continue honoring allowed targets and hook allowlists

## Non-goals

- Unbounded DeFi routing
- Per-agent custom strategy bytecode
