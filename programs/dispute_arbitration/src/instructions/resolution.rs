use anchor_lang::prelude::*;

use crate::errors::DisputeArbitrationError;
use crate::events::{AppealEscalated, DisputeResolved};
use crate::state::*;

#[derive(Accounts)]
pub struct EscalateAppeal<'info> {
    #[account(seeds = [SEED_DISPUTE_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, DisputeConfig>>,

    #[account(
        mut,
        seeds = [SEED_DISPUTE_CASE, dispute_case.case_id.to_le_bytes().as_ref()],
        bump = dispute_case.bump,
    )]
    pub dispute_case: Box<Account<'info, DisputeCase>>,

    #[account(
        init,
        payer = appellant,
        space = 8 + AppealRecord::INIT_SPACE,
        seeds = [SEED_APPEAL, dispute_case.case_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub appeal_record: Box<Account<'info, AppealRecord>>,

    #[account(mut)]
    pub appellant: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn escalate_appeal_handler(ctx: Context<EscalateAppeal>) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, DisputeArbitrationError::Paused);

    let dc = &ctx.accounts.dispute_case;
    require!(
        dc.status == DisputeStatus::Tallied,
        DisputeArbitrationError::WrongStatus
    );
    require!(dc.round == 1, DisputeArbitrationError::TooManyAppeals);

    let now = Clock::get()?.unix_timestamp;

    // appeal_window_secs measured from reveal_deadline (no separate tallied_at field)
    let appeal_deadline = dc.reveal_deadline
        .checked_add(config.appeal_window_secs)
        .ok_or(DisputeArbitrationError::ArithmeticOverflow)?;
    require!(
        now <= appeal_deadline,
        DisputeArbitrationError::AppealWindowClosed
    );

    let appellant_key = ctx.accounts.appellant.key();
    let is_losing_party = match dc.verdict {
        DisputeVerdict::AgentWins => appellant_key == dc.client,
        DisputeVerdict::ClientWins => appellant_key == dc.agent_operator,
        _ => false,
    };
    require!(is_losing_party, DisputeArbitrationError::Unauthorized);

    let collateral = (dc.escrow_amount as u128)
        .checked_mul(config.appeal_collateral_bps as u128)
        .ok_or(DisputeArbitrationError::ArithmeticOverflow)?
        / BPS_DENOMINATOR as u128;
    let collateral = collateral as u64;

    // M2 structural: transfer_checked for collateral lock would go here

    let case_id = dc.case_id;

    let ar = &mut ctx.accounts.appeal_record;
    ar.case_id = case_id;
    ar.appellant = appellant_key;
    ar.round = 2;
    ar.collateral_amount = collateral;
    ar.collateral_mint = dc.payment_mint;
    ar.filed_at = now;
    ar.bump = ctx.bumps.appeal_record;

    let dc = &mut ctx.accounts.dispute_case;
    dc.status = DisputeStatus::Appealed;
    dc.round = 2;

    emit!(AppealEscalated {
        case_id,
        appellant: appellant_key,
        collateral,
        timestamp: now,
    });
    Ok(())
}

// State-before-CPI: Resolved is set before any outbound CPI.
#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(seeds = [SEED_DISPUTE_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, DisputeConfig>>,

    #[account(
        mut,
        seeds = [SEED_DISPUTE_CASE, dispute_case.case_id.to_le_bytes().as_ref()],
        bump = dispute_case.bump,
    )]
    pub dispute_case: Box<Account<'info, DisputeCase>>,

    pub cranker: Signer<'info>,
}

pub fn resolve_dispute_handler(ctx: Context<ResolveDispute>) -> Result<()> {
    let dc = &mut ctx.accounts.dispute_case;
    require!(
        dc.status == DisputeStatus::Tallied,
        DisputeArbitrationError::WrongStatus
    );

    let now = Clock::get()?.unix_timestamp;

    // for round 1: wait until appeal window elapses
    if dc.round == 1 {
        let appeal_deadline = dc.reveal_deadline
            .checked_add(ctx.accounts.config.appeal_window_secs)
            .ok_or(DisputeArbitrationError::ArithmeticOverflow)?;
        require!(
            now > appeal_deadline,
            DisputeArbitrationError::AppealWindowOpen
        );
    }

    let case_id = dc.case_id;
    let task_id = dc.task_id;
    let verdict = dc.verdict;

    dc.status = DisputeStatus::Resolved;
    dc.resolved_at = now;

    // M2 structural: CPI into TaskMarket::execute_dispute_verdict + collateral settlement

    emit!(DisputeResolved {
        case_id,
        task_id,
        verdict,
        timestamp: now,
    });
    Ok(())
}
