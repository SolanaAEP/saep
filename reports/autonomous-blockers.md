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

### unique_execution circuit — 3 security findings (Critical/High)
- **Fixed:** Added execution_root≠0 constraint, full hi_leaf merkle inclusion proof, adjacency check (hi_idx == lo_idx + 1). Circuit rebuilt: 6081 constraints, 38 private inputs.

### SPL Token compat layer
- **Verified:** All programs already use `Interface<'info, TokenInterface>`. hook.rs has SPL early-return guards. No changes needed.

### reputation_cpi.rs security review
- **Result:** No critical findings. 3 MEDIUM (Poseidon hash encoding — verified correct; proof_key replay — adequate via circuit binding; PDA governance risk — by design). EWMA arithmetic safe.

### DisputeArbitration stake_account validation (Critical)
- **Fixed:** Added `#[account(owner = config.nxs_staking)]` constraint. Values still caller-supplied (M2 structural). Pre-audit TODO for NXSStaking CPI reads.

### Governance finalize u128 overflow (High)
- **Fixed:** `checked_mul` on quorum/threshold calculations.

### FeeCollector process_epoch vault bump (High)
- **Fixed:** Use `ctx.bumps.intake_vault` instead of runtime `find_program_address`.
