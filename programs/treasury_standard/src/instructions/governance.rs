use anchor_lang::prelude::*;

use crate::errors::TreasuryError;
use crate::events::PausedSet;
use crate::state::TreasuryGlobal;

#[derive(Accounts)]
pub struct GovernanceUpdate<'info> {
    #[account(
        mut,
        seeds = [b"treasury_global"],
        bump = global.bump,
        has_one = authority @ TreasuryError::Unauthorized,
    )]
    pub global: Account<'info, TreasuryGlobal>,
    pub authority: Signer<'info>,
}

pub fn set_default_daily_limit_handler(
    ctx: Context<GovernanceUpdate>,
    new_default: u64,
) -> Result<()> {
    let g = &mut ctx.accounts.global;
    require!(new_default <= g.max_daily_limit, TreasuryError::InvalidLimits);
    g.default_daily_limit = new_default;
    Ok(())
}

pub fn set_max_daily_limit_handler(
    ctx: Context<GovernanceUpdate>,
    new_max: u64,
) -> Result<()> {
    let g = &mut ctx.accounts.global;
    require!(g.default_daily_limit <= new_max, TreasuryError::InvalidLimits);
    g.max_daily_limit = new_max;
    Ok(())
}

pub fn set_max_stream_duration_handler(
    ctx: Context<GovernanceUpdate>,
    new_duration: i64,
) -> Result<()> {
    require!(new_duration > 0, TreasuryError::InvalidDuration);
    ctx.accounts.global.max_stream_duration = new_duration;
    Ok(())
}

pub fn set_paused_handler(ctx: Context<GovernanceUpdate>, paused: bool) -> Result<()> {
    ctx.accounts.global.paused = paused;
    emit!(PausedSet {
        paused,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
