use anchor_lang::prelude::*;

use crate::errors::DisputeArbitrationError;
use crate::events::{ArbitratorsSelected, DisputeCancelled, DisputeRaised};
use crate::state::*;

// CPI entry from TaskMarket. Caller identity validated structurally in M2.
#[derive(Accounts)]
pub struct RaiseDispute<'info> {
    #[account(
        mut,
        seeds = [SEED_DISPUTE_CONFIG],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, DisputeConfig>>,

    #[account(
        init,
        payer = payer,
        space = 8 + DisputeCase::INIT_SPACE,
        seeds = [SEED_DISPUTE_CASE, config.next_case_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub dispute_case: Box<Account<'info, DisputeCase>>,

    #[account(seeds = [SEED_DISPUTE_POOL], bump = pool.bump)]
    pub pool: Box<Account<'info, DisputePool>>,

    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn raise_dispute_handler(
    ctx: Context<RaiseDispute>,
    task_id: u64,
    client: Pubkey,
    agent_operator: Pubkey,
    escrow_amount: u64,
    payment_mint: Pubkey,
) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, DisputeArbitrationError::Paused);

    let pool = &ctx.accounts.pool;
    require!(
        pool.arbitrator_count >= config.round1_size as u16,
        DisputeArbitrationError::PoolTooSmall
    );

    let now = Clock::get()?.unix_timestamp;
    let case_id = config.next_case_id;

    let dc = &mut ctx.accounts.dispute_case;
    dc.case_id = case_id;
    dc.task_id = task_id;
    dc.client = client;
    dc.agent_operator = agent_operator;
    dc.escrow_amount = escrow_amount;
    dc.payment_mint = payment_mint;
    dc.status = DisputeStatus::RequestedVrf;
    dc.round = 1;
    dc.arbitrators = vec![];
    dc.arbitrator_count = 0;
    dc.vrf_request = Pubkey::default();
    dc.vrf_result = [0u8; 32];
    dc.commit_deadline = 0;
    dc.reveal_deadline = 0;
    dc.verdict = DisputeVerdict::None;
    dc.votes_for_agent = 0;
    dc.votes_for_client = 0;
    dc.votes_for_split = 0;
    dc.total_revealed_weight = 0;
    dc.resolved_at = 0;
    dc.created_at = now;
    dc.snapshot_pool = ctx.accounts.pool.key();
    dc.bump = ctx.bumps.dispute_case;

    ctx.accounts.config.next_case_id = case_id
        .checked_add(1)
        .ok_or(DisputeArbitrationError::ArithmeticOverflow)?;

    emit!(DisputeRaised {
        case_id,
        task_id,
        client,
        agent_operator,
        escrow_amount,
        timestamp: now,
    });
    Ok(())
}

// M2: VRF result passed as arg; Switchboard CPI deferred.
#[derive(Accounts)]
pub struct ConsumeVrf<'info> {
    #[account(seeds = [SEED_DISPUTE_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, DisputeConfig>>,

    #[account(
        mut,
        seeds = [SEED_DISPUTE_CASE, dispute_case.case_id.to_le_bytes().as_ref()],
        bump = dispute_case.bump,
    )]
    pub dispute_case: Box<Account<'info, DisputeCase>>,

    #[account(
        seeds = [SEED_DISPUTE_POOL],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, DisputePool>>,

    pub cranker: Signer<'info>,
}

pub fn consume_vrf_handler(
    ctx: Context<ConsumeVrf>,
    vrf_result: [u8; 32],
) -> Result<()> {
    let dc = &mut ctx.accounts.dispute_case;
    require!(
        dc.status == DisputeStatus::RequestedVrf || dc.status == DisputeStatus::Appealed,
        DisputeArbitrationError::WrongStatus
    );

    let config = &ctx.accounts.config;
    let pool = &ctx.accounts.pool;

    let count = if dc.round == 1 {
        config.round1_size as usize
    } else {
        config.round2_size as usize
    };

    require!(
        pool.arbitrator_count >= count as u16,
        DisputeArbitrationError::PoolTooSmall
    );

    let offset = if dc.round == 1 { 0 } else { MAX_ROUND2_ARBITRATORS };
    let indices = weighted_select(&vrf_result, &pool.cumulative_stakes, count, offset);

    require!(
        indices.len() == count,
        DisputeArbitrationError::PoolTooSmall
    );

    let mut selected = Vec::with_capacity(count);
    for &idx in &indices {
        let arb = pool.arbitrators[idx];
        require!(
            !selected.contains(&arb),
            DisputeArbitrationError::DuplicateVote
        );
        selected.push(arb);
    }

    let now = Clock::get()?.unix_timestamp;
    dc.vrf_result = vrf_result;
    dc.arbitrators = selected.clone();
    dc.arbitrator_count = count as u8;
    dc.status = DisputeStatus::Committing;
    dc.commit_deadline = now + config.commit_window_secs;
    dc.reveal_deadline = now + config.commit_window_secs + config.reveal_window_secs;

    // reset vote tallies for new round
    dc.votes_for_agent = 0;
    dc.votes_for_client = 0;
    dc.votes_for_split = 0;
    dc.total_revealed_weight = 0;
    dc.verdict = DisputeVerdict::None;

    emit!(ArbitratorsSelected {
        case_id: dc.case_id,
        arbitrators: selected,
        round: dc.round,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CancelStaleVrf<'info> {
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

pub fn cancel_stale_vrf_handler(ctx: Context<CancelStaleVrf>) -> Result<()> {
    let dc = &mut ctx.accounts.dispute_case;
    require!(
        dc.status == DisputeStatus::RequestedVrf,
        DisputeArbitrationError::WrongStatus
    );

    let now = Clock::get()?.unix_timestamp;
    let stale_after = dc.created_at
        .checked_add(ctx.accounts.config.commit_window_secs)
        .ok_or(DisputeArbitrationError::ArithmeticOverflow)?;
    require!(
        now > stale_after,
        DisputeArbitrationError::VrfNotFulfilled
    );

    let case_id = dc.case_id;
    let task_id = dc.task_id;
    dc.status = DisputeStatus::Cancelled;

    // M2 structural: CPI into TaskMarket::force_release would go here

    emit!(DisputeCancelled {
        case_id,
        task_id,
        timestamp: now,
    });
    Ok(())
}
