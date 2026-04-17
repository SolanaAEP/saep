use anchor_lang::prelude::*;

use crate::errors::GovernanceError;
use crate::events::VoteCast;
use crate::state::*;

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(seeds = [SEED_GOV_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, GovernanceConfig>>,

    #[account(
        mut,
        seeds = [SEED_PROPOSAL, proposal.proposal_id.to_le_bytes().as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Box<Account<'info, ProposalAccount>>,

    #[account(
        init,
        payer = voter,
        space = 8 + VoteRecord::INIT_SPACE,
        seeds = [SEED_VOTE, proposal.key().as_ref(), voter.key().as_ref()],
        bump,
    )]
    pub vote_record: Box<Account<'info, VoteRecord>>,

    #[account(mut)]
    pub voter: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CastVote>,
    choice: VoteChoice,
    weight: u128,
    merkle_proof: Vec<[u8; 32]>,
) -> Result<()> {
    require!(
        merkle_proof.len() <= MAX_MERKLE_PROOF_DEPTH,
        GovernanceError::MerkleProofTooDeep
    );

    require!(
        ctx.accounts.proposal.status == ProposalStatus::Voting,
        GovernanceError::InvalidProposalStatus
    );

    let now = Clock::get()?.unix_timestamp;
    require!(now < ctx.accounts.proposal.vote_end, GovernanceError::VotingEnded);

    let leaf = compute_vote_leaf(&ctx.accounts.voter.key(), weight);
    require!(
        verify_vote_proof(&merkle_proof, &ctx.accounts.proposal.snapshot.snapshot_root, leaf),
        GovernanceError::MerkleProofInvalid
    );

    let proposal_id = ctx.accounts.proposal.proposal_id;

    let v = &mut ctx.accounts.vote_record;
    v.proposal_id = proposal_id;
    v.voter = ctx.accounts.voter.key();
    v.choice = choice;
    v.weight = weight;
    v.cast_at = now;
    v.bump = ctx.bumps.vote_record;

    let p = &mut ctx.accounts.proposal;
    match choice {
        VoteChoice::For => {
            p.for_weight = p
                .for_weight
                .checked_add(weight)
                .ok_or(GovernanceError::ArithmeticOverflow)?;
        }
        VoteChoice::Against => {
            p.against_weight = p
                .against_weight
                .checked_add(weight)
                .ok_or(GovernanceError::ArithmeticOverflow)?;
        }
        VoteChoice::Abstain => {
            p.abstain_weight = p
                .abstain_weight
                .checked_add(weight)
                .ok_or(GovernanceError::ArithmeticOverflow)?;
        }
    }

    emit!(VoteCast {
        proposal_id,
        voter: ctx.accounts.voter.key(),
        choice,
        weight,
        timestamp: now,
    });
    Ok(())
}
