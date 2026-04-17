use anchor_lang::prelude::*;

use crate::errors::GovernanceError;
use crate::events::ProposalCreated;
use crate::state::*;

#[derive(Accounts)]
pub struct Propose<'info> {
    #[account(
        mut,
        seeds = [SEED_GOV_CONFIG],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, GovernanceConfig>>,

    #[account(seeds = [SEED_PROGRAM_REGISTRY], bump = registry.bump)]
    pub registry: Box<Account<'info, ProgramRegistry>>,

    #[account(
        init,
        payer = proposer,
        space = 8 + ProposalAccount::INIT_SPACE,
        seeds = [SEED_PROPOSAL, config.next_proposal_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub proposal: Box<Account<'info, ProposalAccount>>,

    #[account(mut)]
    pub proposer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<Propose>,
    category: ProposalCategory,
    target_program: Pubkey,
    ix_data: Vec<u8>,
    metadata_uri: Vec<u8>,
    snapshot: ProposalSnapshot,
) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, GovernanceError::Paused);
    require!(!metadata_uri.is_empty(), GovernanceError::EmptyMetadataUri);

    // verify target is registered (except EmergencyPause which targets any registered program)
    let entry = ctx
        .accounts
        .registry
        .entries
        .iter()
        .find(|e| e.program_id == target_program);
    require!(entry.is_some(), GovernanceError::ProgramNotRegistered);
    let entry = entry.unwrap();

    require!(
        ix_data.len() <= entry.max_param_payload_bytes as usize,
        GovernanceError::PayloadTooLarge
    );

    let now = Clock::get()?;
    let vote_window = config.vote_window_for(&category);
    let vote_end = now
        .unix_timestamp
        .checked_add(vote_window)
        .ok_or(GovernanceError::ArithmeticOverflow)?;

    let proposal_id = config.next_proposal_id;

    let p = &mut ctx.accounts.proposal;
    p.proposal_id = proposal_id;
    p.proposer = ctx.accounts.proposer.key();
    p.category = category;
    p.target_program = target_program;
    p.ix_data = ix_data;
    p.metadata_uri = metadata_uri;
    p.snapshot = snapshot;
    p.status = ProposalStatus::Voting;
    p.created_at = now.unix_timestamp;
    p.vote_start = now.unix_timestamp;
    p.vote_end = vote_end;
    p.tallied_at = 0;
    p.executable_at = 0;
    p.executed_at = 0;
    p.for_weight = 0;
    p.against_weight = 0;
    p.abstain_weight = 0;
    p.bump = ctx.bumps.proposal;

    ctx.accounts.config.next_proposal_id = proposal_id
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;

    emit!(ProposalCreated {
        proposal_id,
        proposer: ctx.accounts.proposer.key(),
        category,
        target_program,
        vote_end,
        timestamp: now.unix_timestamp,
    });
    Ok(())
}
