use anchor_lang::prelude::*;

use crate::errors::DisputeArbitrationError;
use crate::events::{ParamsUpdated, PausedSet};
use crate::state::*;

#[derive(Accounts)]
pub struct SetParams<'info> {
    #[account(
        mut,
        seeds = [SEED_DISPUTE_CONFIG],
        bump = config.bump,
        has_one = authority @ DisputeArbitrationError::Unauthorized,
    )]
    pub config: Box<Account<'info, DisputeConfig>>,

    pub authority: Signer<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdateParamsInput {
    pub commit_window_secs: Option<i64>,
    pub reveal_window_secs: Option<i64>,
    pub appeal_window_secs: Option<i64>,
    pub appeal_collateral_bps: Option<u16>,
    pub max_slash_bps: Option<u16>,
    pub slash_timelock_secs: Option<i64>,
    pub min_stake: Option<u64>,
    pub min_lock_secs: Option<i64>,
    pub vrf_stale_slots: Option<u64>,
    pub bad_faith_threshold: Option<u8>,
    pub bad_faith_lookback: Option<u8>,
}

pub fn set_params_handler(
    ctx: Context<SetParams>,
    input: UpdateParamsInput,
) -> Result<()> {
    let c = &mut ctx.accounts.config;

    if let Some(v) = input.commit_window_secs {
        c.commit_window_secs = v;
    }
    if let Some(v) = input.reveal_window_secs {
        c.reveal_window_secs = v;
    }
    if let Some(v) = input.appeal_window_secs {
        c.appeal_window_secs = v;
    }
    if let Some(v) = input.appeal_collateral_bps {
        require!(v <= 10_000, DisputeArbitrationError::InvalidBps);
        c.appeal_collateral_bps = v;
    }
    if let Some(v) = input.max_slash_bps {
        require!(v <= 10_000, DisputeArbitrationError::InvalidBps);
        c.max_slash_bps = v;
    }
    if let Some(v) = input.slash_timelock_secs {
        c.slash_timelock_secs = v;
    }
    if let Some(v) = input.min_stake {
        c.min_stake = v;
    }
    if let Some(v) = input.min_lock_secs {
        c.min_lock_secs = v;
    }
    if let Some(v) = input.vrf_stale_slots {
        c.vrf_stale_slots = v;
    }
    if let Some(v) = input.bad_faith_threshold {
        c.bad_faith_threshold = v;
    }
    if let Some(v) = input.bad_faith_lookback {
        c.bad_faith_lookback = v;
    }

    let now = Clock::get()?.unix_timestamp;
    emit!(ParamsUpdated {
        authority: ctx.accounts.authority.key(),
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetDisputePaused<'info> {
    #[account(
        mut,
        seeds = [SEED_DISPUTE_CONFIG],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, DisputeConfig>>,

    pub authority: Signer<'info>,
}

pub fn set_paused_handler(ctx: Context<SetDisputePaused>, paused: bool) -> Result<()> {
    let c = &ctx.accounts.config;
    require!(
        ctx.accounts.authority.key() == c.authority
            || ctx.accounts.authority.key() == c.emergency_council,
        DisputeArbitrationError::Unauthorized
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
