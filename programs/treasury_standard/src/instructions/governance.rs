use anchor_lang::prelude::*;

use crate::errors::TreasuryError;
use crate::events::PausedSet;
use crate::state::{apply_target_mutation, TreasuryGlobal, MAX_GLOBAL_CALL_TARGETS};

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

pub fn set_global_call_targets_handler(
    ctx: Context<GovernanceUpdate>,
    add: Vec<Pubkey>,
    remove: Vec<Pubkey>,
) -> Result<()> {
    let g = &mut ctx.accounts.global;
    apply_target_mutation(&mut g.global_call_targets, &add, &remove)?;
    require!(
        g.global_call_targets.len() <= MAX_GLOBAL_CALL_TARGETS,
        TreasuryError::TooManyCallTargets
    );
    Ok(())
}
