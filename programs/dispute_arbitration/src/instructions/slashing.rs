use anchor_lang::prelude::*;

use crate::errors::DisputeArbitrationError;
use crate::events::{SlashCancelled, SlashExecuted, SlashProposed};
use crate::state::*;

#[derive(Accounts)]
pub struct SlashArbitrator<'info> {
    #[account(seeds = [SEED_DISPUTE_CONFIG], bump = config.bump, has_one = authority)]
    pub config: Box<Account<'info, DisputeConfig>>,

    #[account(
        seeds = [SEED_DISPUTE_CASE, dispute_case.case_id.to_le_bytes().as_ref()],
        bump = dispute_case.bump,
    )]
    pub dispute_case: Box<Account<'info, DisputeCase>>,

    #[account(
        mut,
        seeds = [SEED_ARBITRATOR, arbitrator.operator.as_ref()],
        bump = arbitrator.bump,
    )]
    pub arbitrator: Box<Account<'info, ArbitratorAccount>>,

    #[account(
        init,
        payer = authority,
        space = 8 + PendingSlash::INIT_SPACE,
        seeds = [SEED_PENDING_SLASH, arbitrator.operator.as_ref()],
        bump,
    )]
    pub pending_slash: Box<Account<'info, PendingSlash>>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn slash_arbitrator_handler(
    ctx: Context<SlashArbitrator>,
    reason_code: u8,
) -> Result<()> {
    let dc = &ctx.accounts.dispute_case;
    require!(
        dc.status == DisputeStatus::Resolved,
        DisputeArbitrationError::WrongStatus
    );

    let config = &ctx.accounts.config;
    let arb = &ctx.accounts.arbitrator;

    let slash_amount = (arb.effective_stake as u128)
        .checked_mul(config.max_slash_bps as u128)
        .ok_or(DisputeArbitrationError::ArithmeticOverflow)?
        / BPS_DENOMINATOR as u128;
    let slash_amount = std::cmp::min(slash_amount as u64, arb.effective_stake);

    let now = Clock::get()?.unix_timestamp;
    let executable_at = now
        .checked_add(config.slash_timelock_secs)
        .ok_or(DisputeArbitrationError::ArithmeticOverflow)?;

    let ps = &mut ctx.accounts.pending_slash;
    ps.arbitrator = arb.operator;
    ps.case_id = dc.case_id;
    ps.amount = slash_amount;
    ps.reason_code = reason_code;
    ps.executable_at = executable_at;
    ps.bump = ctx.bumps.pending_slash;

    let arb = &mut ctx.accounts.arbitrator;
    arb.status = ArbitratorStatus::Paused;
    arb.bad_faith_strikes = arb.bad_faith_strikes.saturating_add(1);

    emit!(SlashProposed {
        arbitrator: arb.operator,
        case_id: dc.case_id,
        amount: slash_amount,
        reason_code,
        executable_at,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteSlash<'info> {
    #[account(seeds = [SEED_DISPUTE_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, DisputeConfig>>,

    #[account(
        mut,
        seeds = [SEED_ARBITRATOR, pending_slash.arbitrator.as_ref()],
        bump = arbitrator.bump,
    )]
    pub arbitrator: Box<Account<'info, ArbitratorAccount>>,

    #[account(
        mut,
        seeds = [SEED_PENDING_SLASH, pending_slash.arbitrator.as_ref()],
        bump = pending_slash.bump,
        close = cranker,
    )]
    pub pending_slash: Box<Account<'info, PendingSlash>>,

    #[account(mut)]
    pub cranker: Signer<'info>,
}

pub fn execute_slash_handler(ctx: Context<ExecuteSlash>) -> Result<()> {
    let ps = &ctx.accounts.pending_slash;
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= ps.executable_at,
        DisputeArbitrationError::SlashTimelockNotElapsed
    );

    let amount = ps.amount;
    let case_id = ps.case_id;
    let operator = ps.arbitrator;

    // M2 structural: CPI into NXSStaking → fee_collector for slashed amount
    let arb = &mut ctx.accounts.arbitrator;
    if arb.bad_faith_strikes >= ctx.accounts.config.bad_faith_threshold {
        arb.status = ArbitratorStatus::Slashed;
    } else {
        arb.status = ArbitratorStatus::Active;
    }

    emit!(SlashExecuted {
        arbitrator: operator,
        case_id,
        amount,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CancelSlash<'info> {
    #[account(
        seeds = [SEED_DISPUTE_CONFIG],
        bump = config.bump,
        has_one = authority @ DisputeArbitrationError::Unauthorized,
    )]
    pub config: Box<Account<'info, DisputeConfig>>,

    #[account(
        mut,
        seeds = [SEED_ARBITRATOR, pending_slash.arbitrator.as_ref()],
        bump = arbitrator.bump,
    )]
    pub arbitrator: Box<Account<'info, ArbitratorAccount>>,

    #[account(
        mut,
        seeds = [SEED_PENDING_SLASH, pending_slash.arbitrator.as_ref()],
        bump = pending_slash.bump,
        close = authority,
    )]
    pub pending_slash: Box<Account<'info, PendingSlash>>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

pub fn cancel_slash_handler(ctx: Context<CancelSlash>) -> Result<()> {
    let ps = &ctx.accounts.pending_slash;
    let now = Clock::get()?.unix_timestamp;
    require!(
        now < ps.executable_at,
        DisputeArbitrationError::SlashTimelockNotElapsed
    );

    let operator = ps.arbitrator;
    let case_id = ps.case_id;

    let arb = &mut ctx.accounts.arbitrator;
    arb.status = ArbitratorStatus::Active;
    arb.bad_faith_strikes = arb.bad_faith_strikes.saturating_sub(1);

    emit!(SlashCancelled {
        arbitrator: operator,
        case_id,
        timestamp: now,
    });
    Ok(())
}
