# Pre-audit 05 — Token-2022 TransferHook program whitelist

Parent: `backlog/P0_pre_audit_hardening.md` item 5.
Threat: Token-2022 `TransferHook` extension lets a mint designate an arbitrary program that runs on every transfer. An attacker-controlled (or compromised) hook can:
- Revert transfers selectively (DoS escrow claims).
- Consume CU / accounts maliciously to block settlement.
- Exfiltrate state by reading caller accounts.
- Collude with fee accounts to double-deduct.

SAEP accepts third-party mints (for payment, for rewards) and itself plans a Token-2022 SAEP mint at M3. Both sides need whitelisting: canonical mints we actively trust, and unknown mints blocked by default from high-value program flows.

## Design

### fee_collector

```rust
pub const MAX_HOOK_PROGRAMS: usize = 16;

#[account]
#[derive(InitSpace)]
pub struct HookAllowlist {
    pub authority: Pubkey,
    #[max_len(MAX_HOOK_PROGRAMS)]
    pub programs: Vec<Pubkey>,
    pub default_deny: bool,    // true = reject unknown; false = log-only (M1 warn mode)
    pub bump: u8,
}
```

PDA: `[b"hook_allowlist"]` — single global under fee_collector. Managed by governance.

### treasury_standard

`TreasuryGlobal` gains:
```rust
pub hook_allowlist: Pubkey,   // points to fee_collector::HookAllowlist
```

`AgentTreasury` gains optional per-agent override:
```rust
pub const MAX_AGENT_HOOK_PROGRAMS: usize = 4;

#[account]
#[derive(InitSpace)]
pub struct AgentHookAllowlist {
    pub agent_did: [u8; 32],
    #[max_len(MAX_AGENT_HOOK_PROGRAMS)]
    pub extra_programs: Vec<Pubkey>,  // additive to global, never subtractive
    pub bump: u8,
}
```

PDA: `[b"agent_hooks", agent_did]`. Optional; treasury checks this plus global.

### Enforcement helper

Shared helper in `programs/fee_collector/src/lib.rs` (re-exported crate):

```rust
pub fn assert_hook_allowed(
    mint_info: &AccountInfo,
    global: &HookAllowlist,
    per_agent: Option<&AgentHookAllowlist>,
) -> Result<()> {
    let hook_program = get_transfer_hook_program_id(mint_info)?;  // spl-token-2022 helper
    match hook_program {
        None => Ok(()), // mint has no hook — fine
        Some(pid) => {
            if global.programs.contains(&pid) { return Ok(()); }
            if let Some(a) = per_agent {
                if a.extra_programs.contains(&pid) { return Ok(()); }
            }
            if global.default_deny {
                err!(FeeCollectorError::HookNotAllowed)
            } else {
                msg!("WARN: unwhitelisted hook program {}", pid);
                Ok(())
            }
        }
    }
}
```

### Call sites (enforcement, not advisory)

Every `transfer_checked` or `transfer_checked_with_transfer_hook` CPI in:
- `task_market::fund_task` (client pays escrow)
- `task_market::release` (escrow → agent)
- `task_market::refund` (escrow → client)
- `treasury_standard::stream_withdraw` (escrow → counterparty)
- `treasury_standard::swap_via_jupiter` (pre-swap source transfer)
- `fee_collector::collect_fee` (fee pull)

…wraps with `assert_hook_allowed(mint, global, per_agent)` before the CPI.

### Mint-extension sanity checks at accept time

New ix `task_market::allow_payment_mint` (extends existing pattern): when governance adds a mint to `MarketGlobal.allowed_payment_mints`, it must:
1. Inspect mint's Token-2022 extensions.
2. Reject if `TransferFeeConfig` is set and `transfer_fee_config_authority` is not none or governance-held (kills silent fee hikes).
3. Reject if `DefaultAccountState == Frozen` (kills silent freeze).
4. Reject if `PermanentDelegate` set (kills silent rug).
5. Reject if hook program present and not in allowlist.

Store these check results as a packed u32 `mint_accept_flags` in a `MintAcceptRecord` PDA `[b"mint_accept", mint]` so the indexer and UI can surface "we verified this mint at accept-time on slot X".

## Invariants

1. Any enforcement call site invoked with a mint whose hook program isn't in global ∪ per-agent, under `default_deny == true`, → `HookNotAllowed`.
2. `HookAllowlist.programs.len() <= MAX_HOOK_PROGRAMS`.
3. Only authority (governance) can mutate `HookAllowlist`.
4. Adding a mint with disallowed extension flags → `MintExtensionRejected`.
5. `default_deny` flip is governance-only and event-emitted.

## Events

- `HookAllowlistUpdated { added, removed, default_deny }`
- `MintAccepted { mint, accept_flags, hook_program, slot }`
- `HookRejected { mint, hook_program, site }` (defensive: fires when rejected at call site)

## Rollout

- M1 devnet: `default_deny = false` (warn-only), allowlist pre-populated with Jupiter's referral hook + the SAEP testing hook (none yet). Collect telemetry for two weeks.
- M1 audit submission: `default_deny = true`. OtterSec reviews policy + call site coverage.

## Verify

```
cargo test -p fee_collector hook_allowlist_
cargo test -p task_market fund_task_rejects_unknown_hook
cargo test -p treasury_standard swap_rejects_unknown_hook
anchor test tests/hook_whitelist.ts   # spins a mint with custom hook, asserts reject
```

## Open questions

- How to classify Jupiter's own referral/route-aware hooks if they add one — monitor Jupiter release notes at audit window.
- Do we enforce on source mint, destination mint, or both? Answer: both — attacker can set hooks on either side. Helper called per mint, sites pass whichever mints they touch.
