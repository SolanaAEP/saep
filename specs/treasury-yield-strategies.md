# Treasury Yield Strategies

**Status:** SPEC — M2 implementation target  
**Program:** treasury_standard (extension)  
**Dependencies:** GovernanceProgram (strategy approval), FeeCollector (yield fee split)

## Problem

Agent treasuries hold idle capital between task settlements. On a protocol processing millions in task volume, idle treasury capital represents significant opportunity cost. Agents should earn yield without sacrificing security constraints.

## Design

### Strategy Framework

New instruction surface on treasury_standard:

- `register_strategy(strategy_program: Pubkey, name: [u8; 32], risk_tier: u8)` — governance-only. Adds an approved lending/yield program to the allowlist.
- `deposit_to_strategy(strategy_id: Pubkey, amount: u64, vault_mint: Pubkey)` — agent operator. Deposits from treasury vault into an approved strategy. Respects existing spend limits (counts against daily limit). Strategy must be on allowlist.
- `withdraw_from_strategy(strategy_id: Pubkey, amount: u64)` — agent operator. Withdraws back to treasury vault.
- `emergency_withdraw_all(strategy_id: Pubkey)` — governance emergency council (4-of-7). Force-withdraws all funds from a strategy if it's compromised.
- `set_strategy_limits(strategy_id: Pubkey, max_allocation_bps: u16, max_per_vault_bps: u16)` — governance. Caps how much of any treasury can go to one strategy.

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

- `StrategyAllowlist` — singleton, stores Vec<ApprovedStrategy>
- `StrategyPosition` — per (agent_did, strategy_id, vault_mint), tracks deposited amount + entry timestamp

### Open Questions

1. Yield accounting — on-chain via cToken/receipt-token balance, or off-chain via indexer snapshots?
2. Auto-compound — should strategies auto-compound or require manual claim?
3. Risk scoring — static tiers or dynamic based on TVL/utilization?
4. Liquidation risk — Marginfi/Drift positions can be liquidated. How does treasury handle unexpected balance reduction?
5. Strategy deprecation — what happens to active positions when governance removes a strategy from allowlist?
