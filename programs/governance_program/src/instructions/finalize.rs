use anchor_lang::prelude::*;

use crate::errors::GovernanceError;
use crate::events::ProposalFinalized;
use crate::state::*;

#[derive(Accounts)]
pub struct FinalizeVote<'info> {
    #[account(seeds = [SEED_GOV_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, GovernanceConfig>>,

    #[account(seeds = [SEED_PROGRAM_REGISTRY], bump = registry.bump)]
    pub registry: Box<Account<'info, ProgramRegistry>>,

    #[account(
        mut,
        seeds = [SEED_PROPOSAL, proposal.proposal_id.to_le_bytes().as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Box<Account<'info, ProposalAccount>>,

    pub cranker: Signer<'info>,
}

pub fn handler(ctx: Context<FinalizeVote>) -> Result<()> {
    let config = &ctx.accounts.config;
    let proposal = &ctx.accounts.proposal;

    require!(
        proposal.status == ProposalStatus::Voting,
        GovernanceError::InvalidProposalStatus
    );

    let now = Clock::get()?.unix_timestamp;
    require!(now >= proposal.vote_end, GovernanceError::VotingNotEnded);

    let total_voted = proposal
        .for_weight
        .checked_add(proposal.against_weight)
        .ok_or(GovernanceError::ArithmeticOverflow)?
        .checked_add(proposal.abstain_weight)
        .ok_or(GovernanceError::ArithmeticOverflow)?;

    // quorum check: total_voted >= total_eligible * quorum_bps / 10_000
    let quorum_threshold =
        (proposal.snapshot.total_eligible_weight * config.quorum_bps as u128) / 10_000;
    let quorum_met = total_voted >= quorum_threshold;

    // pass check: for_weight > (for_weight + against_weight) * threshold / 10_000
    let decisive_weight = proposal
        .for_weight
        .checked_add(proposal.against_weight)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let threshold = config.threshold_for(&proposal.category);
    let pass_threshold = (decisive_weight * threshold as u128) / 10_000;
    let passed = quorum_met && proposal.for_weight > pass_threshold;

    let is_critical = ctx
        .accounts
        .registry
        .entries
        .iter()
        .find(|e| e.program_id == proposal.target_program)
        .map(|e| e.is_critical)
        .unwrap_or(false);

    let p = &mut ctx.accounts.proposal;
    p.tallied_at = now;

    if passed {
        let timelock = config.timelock_for(&p.category, is_critical);
        p.executable_at = now
            .checked_add(timelock)
            .ok_or(GovernanceError::ArithmeticOverflow)?;
        p.status = ProposalStatus::Passed;
    } else {
        p.status = ProposalStatus::Rejected;
    }

    emit!(ProposalFinalized {
        proposal_id: p.proposal_id,
        status: p.status,
        for_weight: p.for_weight,
        against_weight: p.against_weight,
        abstain_weight: p.abstain_weight,
        timestamp: now,
    });
    Ok(())
}
