use anchor_lang::prelude::*;

use crate::errors::TreasuryError;
use crate::events::LimitsUpdated;
use crate::state::{validate_limits, AgentTreasury, TreasuryGlobal};

#[derive(Accounts)]
pub struct SetLimits<'info> {
    #[account(seeds = [b"treasury_global"], bump = global.bump)]
    pub global: Account<'info, TreasuryGlobal>,

    #[account(
        mut,
        seeds = [b"treasury", treasury.agent_did.as_ref()],
        bump = treasury.bump,
        has_one = operator @ TreasuryError::Unauthorized,
    )]
    pub treasury: Account<'info, AgentTreasury>,

    pub operator: Signer<'info>,
}

pub fn handler(
    ctx: Context<SetLimits>,
    daily: u64,
    per_tx: u64,
    weekly: u64,
) -> Result<()> {
    let g = &ctx.accounts.global;
    require!(!g.paused, TreasuryError::Paused);
    require!(daily <= g.max_daily_limit, TreasuryError::InvalidLimits);
    validate_limits(per_tx, daily, weekly)?;

    let t = &mut ctx.accounts.treasury;
    t.daily_spend_limit = daily;
    t.per_tx_limit = per_tx;
    t.weekly_limit = weekly;

    emit!(LimitsUpdated {
        agent_did: t.agent_did,
        daily,
        per_tx,
        weekly,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
