use anchor_lang::prelude::*;

use crate::errors::AgentRegistryError;
use crate::events::GlobalParamsUpdated;
use crate::state::{RegistryGlobal, MAX_SLASH_BPS_CAP};

#[derive(Accounts)]
pub struct GovernanceUpdate<'info> {
    #[account(
        mut,
        seeds = [b"global"],
        bump = global.bump,
        has_one = authority @ AgentRegistryError::Unauthorized,
    )]
    pub global: Account<'info, RegistryGlobal>,
    pub authority: Signer<'info>,
}

pub fn set_min_stake_handler(ctx: Context<GovernanceUpdate>, new_min_stake: u64) -> Result<()> {
    ctx.accounts.global.min_stake = new_min_stake;
    emit!(GlobalParamsUpdated {
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn set_max_slash_bps_handler(
    ctx: Context<GovernanceUpdate>,
    new_max_slash_bps: u16,
) -> Result<()> {
    require!(
        new_max_slash_bps <= MAX_SLASH_BPS_CAP,
        AgentRegistryError::SlashCapTooHigh
    );
    ctx.accounts.global.max_slash_bps = new_max_slash_bps;
    emit!(GlobalParamsUpdated {
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn set_slash_timelock_handler(
    ctx: Context<GovernanceUpdate>,
    new_timelock_secs: i64,
) -> Result<()> {
    require!(new_timelock_secs > 0, AgentRegistryError::TimelockNotElapsed);
    ctx.accounts.global.slash_timelock_secs = new_timelock_secs;
    emit!(GlobalParamsUpdated {
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn set_paused_handler(ctx: Context<GovernanceUpdate>, paused: bool) -> Result<()> {
    ctx.accounts.global.paused = paused;
    emit!(GlobalParamsUpdated {
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn set_civic_gateway_program_handler(
    ctx: Context<GovernanceUpdate>,
    new_civic_gateway_program: Pubkey,
) -> Result<()> {
    ctx.accounts.global.civic_gateway_program = new_civic_gateway_program;
    emit!(GlobalParamsUpdated {
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
