# Treasury Yield Strategies

**Status:** SPEC — control plane landed first; venue CPIs remain M2 adapter work  
**Program:** treasury_standard (extension)  
**Dependencies:** GovernanceProgram (strategy approval), FeeCollector (yield fee split)

## Problem

Agent treasuries hold idle capital between task settlements. On a protocol processing millions in task volume, idle treasury capital represents significant opportunity cost. Agents should earn yield without sacrificing security constraints.

## Design

### Strategy Framework

Control-plane instruction surface on `treasury_standard`:

- `register_yield_strategy(...)` — governance-only. Adds a strategy descriptor with venue, program, underlying mint, receipt mint, risk tier, cap, name, and metadata URI.
- `set_yield_strategy_status(status)` — governance-only pause/revoke control for an approved strategy.
- `set_treasury_yield_config(agent_did, strategy_id, allocation_bps, paused)` — treasury operator opt-in under the strategy cap.
- `request_treasury_yield_unwind()` — treasury operator emergency unwind signal.
- `record_treasury_yield_accounting(idle_amount, deployed_amount, realized_yield_amount, accounting_slot)` — authority-recorded accounting event for indexer snapshots.

Venue adapter instruction surface, still ahead:

- `deposit_to_strategy(strategy_id, amount, vault_mint)` — agent operator. Deposits from treasury vault into an approved strategy. Respects existing spend limits and strategy allocation caps.
- `withdraw_from_strategy(strategy_id, amount)` — agent operator. Withdraws back to treasury vault.
- `emergency_withdraw_all(strategy_id)` — governance emergency council. Force-withdraws all funds from a strategy if compromised.

### Approved Strategy Targets (M2 candidates)

| Protocol | Type | Risk Tier | CPI Surface |
|---|---|---|---|
| Kamino Finance | Lending/LP | 1 (low) | `deposit` / `withdraw` via kamino-lending CPI |
| Marginfi | Lending | 1 (low) | `lending_account_deposit` / `withdraw` |
| Drift | Perps/Lending | 2 (medium) | `deposit` / `withdraw` via drift CPI |
| Jupiter DCA | DCA vaults | 1 (low) | Already integrated in treasury_standard |

### Security Constraints

1. **Allowlist-only** — no arbitrary program CPI. Every strategy must be governance-approved.
2. **Spend limits respected** — yield deposits count against daily/weekly spend limits.
3. **Emergency withdrawal** — 4-of-7 council can force-withdraw from any strategy in <1 block.
4. **Max allocation cap** — governance sets per-strategy and per-vault caps (e.g., max 50% of any vault to Kamino).
5. **No leverage** — strategy deposits are 1:1 principal only. No margin, no borrowing.
6. **Yield fee** — protocol takes X% of earned yield, routed to FeeCollector (exact % set by governance).
7. **Audit gate** — each strategy CPI adapter requires OtterSec/Neodyme review before mainnet activation.

### PDA Structure

- `YieldStrategyDescriptor` — per strategy PDA, stores governance-approved descriptor and status.
- `TreasuryYieldConfig` — per treasury PDA, stores selected strategy, allocation bps, unwind state, and latest accounting fields.
- `StrategyPosition` — future per `(agent_did, strategy_id, vault_mint)` adapter PDA, tracks deposited amount + entry timestamp once external CPIs land.

### Open Questions

1. Yield accounting — on-chain via cToken/receipt-token balance, or off-chain via indexer snapshots?
2. Auto-compound — should strategies auto-compound or require manual claim?
3. Risk scoring — static tiers or dynamic based on TVL/utilization?
4. Liquidation risk — Marginfi/Drift positions can be liquidated. How does treasury handle unexpected balance reduction?
5. Strategy deprecation — what happens to active positions when governance removes a strategy from allowlist?
