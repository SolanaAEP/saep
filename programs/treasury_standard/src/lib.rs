use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod guard;
pub mod instructions;
pub mod jupiter;
pub mod state;

#[cfg(test)]
mod fuzz;

use instructions::*;

declare_id!("6boJQg4L6FRS7YZ5rFXfKUaXSy3eCKnW2SdrT3LJLizQ");

#[program]
pub mod treasury_standard {
    use super::*;

    pub fn init_global(
        ctx: Context<InitGlobal>,
        authority: Pubkey,
        agent_registry: Pubkey,
        jupiter_program: Pubkey,
        default_daily_limit: u64,
        max_daily_limit: u64,
    ) -> Result<()> {
        instructions::init_global::handler(
            ctx,
            authority,
            agent_registry,
            jupiter_program,
            default_daily_limit,
            max_daily_limit,
        )
    }

    pub fn init_treasury(
        ctx: Context<InitTreasury>,
        agent_did: [u8; 32],
        daily_spend_limit: u64,
        per_tx_limit: u64,
        weekly_limit: u64,
    ) -> Result<()> {
        instructions::init_treasury::handler(
            ctx,
            agent_did,
            daily_spend_limit,
            per_tx_limit,
            weekly_limit,
        )
    }

    pub fn fund_treasury(ctx: Context<FundTreasury>, amount: u64) -> Result<()> {
        instructions::fund_treasury::handler(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw::handler(ctx, amount)
    }

    pub fn set_limits(
        ctx: Context<SetLimits>,
        daily: u64,
        per_tx: u64,
        weekly: u64,
    ) -> Result<()> {
        instructions::set_limits::handler(ctx, daily, per_tx, weekly)
    }

    pub fn init_stream(
        ctx: Context<InitStream>,
        stream_nonce: [u8; 8],
        rate_per_sec: u64,
        max_duration: i64,
    ) -> Result<()> {
        instructions::init_stream::handler(ctx, stream_nonce, rate_per_sec, max_duration)
    }

    pub fn withdraw_earned<'a>(ctx: Context<'a, WithdrawEarned<'a>>, route_data: Vec<u8>) -> Result<()> {
        instructions::withdraw_earned::handler(ctx, route_data)
    }

    pub fn close_stream(ctx: Context<CloseStream>) -> Result<()> {
        instructions::close_stream::handler(ctx)
    }

    pub fn pay_task(ctx: Context<PayTask>, amount: u64) -> Result<()> {
        instructions::pay_task::handler(ctx, amount)
    }

    pub fn add_allowed_mint(ctx: Context<GovernMints>, mint: Pubkey) -> Result<()> {
        instructions::allowed_mints::add_allowed_mint_handler(ctx, mint)
    }

    pub fn remove_allowed_mint(ctx: Context<GovernMints>, mint: Pubkey) -> Result<()> {
        instructions::allowed_mints::remove_allowed_mint_handler(ctx, mint)
    }

    pub fn set_default_daily_limit(
        ctx: Context<GovernanceUpdate>,
        new_default: u64,
    ) -> Result<()> {
        instructions::governance::set_default_daily_limit_handler(ctx, new_default)
    }

    pub fn set_max_daily_limit(
        ctx: Context<GovernanceUpdate>,
        new_max: u64,
    ) -> Result<()> {
        instructions::governance::set_max_daily_limit_handler(ctx, new_max)
    }

    pub fn set_max_stream_duration(
        ctx: Context<GovernanceUpdate>,
        new_duration: i64,
    ) -> Result<()> {
        instructions::governance::set_max_stream_duration_handler(ctx, new_duration)
    }

    pub fn set_paused(ctx: Context<GovernanceUpdate>, paused: bool) -> Result<()> {
        instructions::governance::set_paused_handler(ctx, paused)
    }

    pub fn set_global_call_targets(
        ctx: Context<GovernanceUpdate>,
        add: Vec<Pubkey>,
        remove: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::governance::set_global_call_targets_handler(ctx, add, remove)
    }

    pub fn set_hook_allowlist_ptr(
        ctx: Context<GovernanceUpdate>,
        hook_allowlist: Pubkey,
    ) -> Result<()> {
        instructions::governance::set_hook_allowlist_ptr_handler(ctx, hook_allowlist)
    }

    pub fn init_allowed_targets(
        ctx: Context<InitAllowedTargets>,
        agent_did: [u8; 32],
        targets: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::allowed_targets::init_handler(ctx, agent_did, targets)
    }

    pub fn update_allowed_targets(
        ctx: Context<UpdateAllowedTargets>,
        add: Vec<Pubkey>,
        remove: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::allowed_targets::update_handler(ctx, add, remove)
    }

    pub fn transfer_authority(
        ctx: Context<TransferAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        instructions::authority::transfer_authority_handler(ctx, new_authority)
    }

    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        instructions::authority::accept_authority_handler(ctx)
    }

    pub fn init_guard(
        ctx: Context<InitGuard>,
        initial_callers: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::guard::init_guard_handler(ctx, initial_callers)
    }

    pub fn set_allowed_callers(
        ctx: Context<SetAllowedCallers>,
        programs: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::guard::set_allowed_callers_handler(ctx, programs)
    }

    pub fn propose_guard_reset(ctx: Context<ProposeGuardReset>) -> Result<()> {
        instructions::guard::propose_guard_reset_handler(ctx)
    }

    pub fn admin_reset_guard(ctx: Context<AdminResetGuard>) -> Result<()> {
        instructions::guard::admin_reset_guard_handler(ctx)
    }
}
