use anchor_lang::prelude::*;

use crate::errors::FeeCollectorError;
use crate::events::{DistributionParamsUpdated, PausedSet};
use crate::state::*;

#[derive(Accounts)]
pub struct SetDistributionParams<'info> {
    #[account(
        mut,
        seeds = [SEED_FEE_CONFIG],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, FeeCollectorConfig>>,

    /// meta_authority (Squads 6-of-9 via governance CPI)
    pub authority: Signer<'info>,
}

pub fn set_distribution_handler(
    ctx: Context<SetDistributionParams>,
    burn_bps: u16,
    staker_share_bps: u16,
    grant_share_bps: u16,
    treasury_share_bps: u16,
) -> Result<()> {
    let c = &ctx.accounts.config;
    require_keys_eq!(
        ctx.accounts.authority.key(),
        c.meta_authority,
        FeeCollectorError::Unauthorized
    );

    let total = burn_bps as u32 + staker_share_bps as u32 + grant_share_bps as u32 + treasury_share_bps as u32;
    require!(total == 10_000, FeeCollectorError::InvalidBpsSum);

    require!(burn_bps <= c.burn_cap_bps, FeeCollectorError::BucketCapExceeded);
    require!(staker_share_bps <= c.staker_cap_bps, FeeCollectorError::BucketCapExceeded);
    require!(grant_share_bps <= c.grant_cap_bps, FeeCollectorError::BucketCapExceeded);
    require!(treasury_share_bps <= c.treasury_cap_bps, FeeCollectorError::BucketCapExceeded);

    let c = &mut ctx.accounts.config;
    c.burn_bps = burn_bps;
    c.staker_share_bps = staker_share_bps;
    c.grant_share_bps = grant_share_bps;
    c.treasury_share_bps = treasury_share_bps;

    let now = Clock::get()?.unix_timestamp;
    emit!(DistributionParamsUpdated {
        burn_bps,
        staker_share_bps,
        grant_share_bps,
        treasury_share_bps,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(
        mut,
        seeds = [SEED_FEE_CONFIG],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, FeeCollectorConfig>>,

    pub authority: Signer<'info>,
}

pub fn set_paused_handler(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    let c = &ctx.accounts.config;
    require!(
        ctx.accounts.authority.key() == c.authority
            || ctx.accounts.authority.key() == c.emergency_council,
        FeeCollectorError::Unauthorized
    );

    ctx.accounts.config.paused = paused;

    let now = Clock::get()?.unix_timestamp;
    emit!(PausedSet {
        paused,
        authority: ctx.accounts.authority.key(),
        timestamp: now,
    });
    Ok(())
}
