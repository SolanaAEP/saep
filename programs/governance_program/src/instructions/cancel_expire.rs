use anchor_lang::prelude::*;

use crate::errors::GovernanceError;
use crate::events::{ProposalCancelled, ProposalExpired};
use crate::state::*;

#[derive(Accounts)]
pub struct ProposerCancel<'info> {
    #[account(
        mut,
        seeds = [SEED_PROPOSAL, proposal.proposal_id.to_le_bytes().as_ref()],
        bump = proposal.bump,
        has_one = proposer @ GovernanceError::Unauthorized,
    )]
    pub proposal: Box<Account<'info, ProposalAccount>>,

    pub proposer: Signer<'info>,
}

pub fn cancel_handler(ctx: Context<ProposerCancel>) -> Result<()> {
    require!(
        ctx.accounts.proposal.status == ProposalStatus::Voting,
        GovernanceError::InvalidProposalStatus
    );

    let now = Clock::get()?.unix_timestamp;
    require!(
        now <= ctx.accounts.proposal.created_at,
        GovernanceError::CannotCancelAfterVoteStart
    );

    let proposal_id = ctx.accounts.proposal.proposal_id;
    ctx.accounts.proposal.status = ProposalStatus::Cancelled;

    emit!(ProposalCancelled {
        proposal_id,
        by: ctx.accounts.proposer.key(),
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ExpireProposal<'info> {
    #[account(
        mut,
        seeds = [SEED_PROPOSAL, proposal.proposal_id.to_le_bytes().as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Box<Account<'info, ProposalAccount>>,

    pub cranker: Signer<'info>,
}

pub fn expire_handler(ctx: Context<ExpireProposal>) -> Result<()> {
    require!(
        ctx.accounts.proposal.status == ProposalStatus::Queued,
        GovernanceError::InvalidProposalStatus
    );

    let now = Clock::get()?.unix_timestamp;
    let deadline = ctx
        .accounts
        .proposal
        .executable_at
        .checked_add(EXECUTION_WINDOW_SECS)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    require!(
        now > deadline,
        GovernanceError::ExecutionWindowExpired
    );

    let proposal_id = ctx.accounts.proposal.proposal_id;
    ctx.accounts.proposal.status = ProposalStatus::Expired;

    emit!(ProposalExpired {
        proposal_id,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(
        mut,
        seeds = [SEED_GOV_CONFIG],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, GovernanceConfig>>,

    pub authority: Signer<'info>,
}

pub fn set_paused_handler(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    let c = &ctx.accounts.config;
    require!(
        ctx.accounts.authority.key() == c.authority
            || ctx.accounts.authority.key() == c.emergency_council,
        GovernanceError::Unauthorized
    );

    ctx.accounts.config.paused = paused;

    let now = Clock::get()?.unix_timestamp;
    emit!(crate::events::PausedSet {
        paused,
        authority: ctx.accounts.authority.key(),
        timestamp: now,
    });
    Ok(())
}
