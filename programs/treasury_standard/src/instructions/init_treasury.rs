use anchor_lang::prelude::*;

use crate::errors::TreasuryError;
use crate::events::TreasuryCreated;
use crate::state::{
    check_agent_operator, iso_week, unix_day, validate_limits, AgentTreasury, TreasuryGlobal,
};

#[derive(Accounts)]
#[instruction(agent_did: [u8; 32])]
pub struct InitTreasury<'info> {
    #[account(seeds = [b"treasury_global"], bump = global.bump)]
    pub global: Account<'info, TreasuryGlobal>,

    #[account(
        init,
        payer = operator,
        space = 8 + AgentTreasury::INIT_SPACE,
        seeds = [b"treasury", agent_did.as_ref()],
        bump,
    )]
    pub treasury: Account<'info, AgentTreasury>,

    #[account(mut)]
    pub operator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitTreasury>,
    agent_did: [u8; 32],
    daily_spend_limit: u64,
    per_tx_limit: u64,
    weekly_limit: u64,
) -> Result<()> {
    let g = &ctx.accounts.global;
    require!(!g.paused, TreasuryError::Paused);
    require!(
        daily_spend_limit <= g.max_daily_limit,
        TreasuryError::InvalidLimits
    );
    validate_limits(per_tx_limit, daily_spend_limit, weekly_limit)?;

    check_agent_operator(&g.agent_registry, &ctx.accounts.operator.key(), &agent_did)?;

    let now = Clock::get()?.unix_timestamp;
    let t = &mut ctx.accounts.treasury;
    t.agent_did = agent_did;
    t.operator = ctx.accounts.operator.key();
    t.daily_spend_limit = daily_spend_limit;
    t.per_tx_limit = per_tx_limit;
    t.weekly_limit = weekly_limit;
    t.spent_today = 0;
    t.spent_this_week = 0;
    t.last_reset_day = unix_day(now);
    t.last_reset_week = iso_week(now);
    t.streaming_active = false;
    t.stream_counterparty = None;
    t.stream_rate_per_sec = 0;
    t.bump = ctx.bumps.treasury;

    emit!(TreasuryCreated {
        agent_did,
        operator: ctx.accounts.operator.key(),
        daily_spend_limit,
        per_tx_limit,
        weekly_limit,
        timestamp: now,
    });
    Ok(())
}
