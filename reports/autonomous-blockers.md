# Autonomous Blockers — 2026-04-17

## Active

### Devnet deploy blocked on SOL balance
- **Status:** BLOCKED
- **Detail:** 2.78 SOL available, need ~10+ SOL for remaining M1 programs (agent_registry 577KB, treasury_standard 646KB). task_market already deployed. Airdrop rate-limited.
- **Action needed:** Fund devnet wallet or wait for airdrop cooldown. Wallet: `8xbXHAhiVe2BrYDq4qpTA5SSYJG9XNjNN6jcrudhTKCM`

### wXRP/RLUSD mint metadata
- **Status:** DEFERRED
- **Detail:** No wXRP or RLUSD SPL mints exist on Solana yet. SDK `PaymentMintMeta` type ready. Nothing to add until mints are bridged.

## Resolved

### DisputeArbitration stake_account validation (Critical)
- **Fixed:** Added `#[account(owner = config.nxs_staking)]` constraint. Values still caller-supplied (M2 structural). Pre-audit TODO for NXSStaking CPI reads.

### Governance finalize u128 overflow (High)
- **Fixed:** `checked_mul` on quorum/threshold calculations.

### FeeCollector process_epoch vault bump (High)
- **Fixed:** Use `ctx.bumps.intake_vault` instead of runtime `find_program_address`.
