use anchor_lang::prelude::*;

use crate::errors::DisputeArbitrationError;
use crate::events::{RoundTallied, VoteCommitted, VoteRevealed};
use crate::state::*;

// --- Commit Vote ---

#[derive(Accounts)]
pub struct CommitVote<'info> {
    #[account(seeds = [SEED_DISPUTE_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, DisputeConfig>>,

    #[account(
        seeds = [SEED_DISPUTE_CASE, dispute_case.case_id.to_le_bytes().as_ref()],
        bump = dispute_case.bump,
    )]
    pub dispute_case: Box<Account<'info, DisputeCase>>,

    #[account(
        seeds = [SEED_ARBITRATOR, arbitrator_signer.key().as_ref()],
        bump = arbitrator.bump,
        has_one = operator @ DisputeArbitrationError::Unauthorized,
    )]
    pub arbitrator: Box<Account<'info, ArbitratorAccount>>,

    #[account(
        init,
        payer = arbitrator_signer,
        space = 8 + DisputeVoteRecord::INIT_SPACE,
        seeds = [
            SEED_DISPUTE_VOTE,
            dispute_case.case_id.to_le_bytes().as_ref(),
            arbitrator_signer.key().as_ref(),
            &[dispute_case.round],
        ],
        bump,
    )]
    pub vote_record: Box<Account<'info, DisputeVoteRecord>>,

    /// CHECK: operator key validated via arbitrator.has_one
    #[account(address = arbitrator.operator @ DisputeArbitrationError::Unauthorized)]
    pub operator: AccountInfo<'info>,

    #[account(mut)]
    pub arbitrator_signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn commit_vote_handler(
    ctx: Context<CommitVote>,
    commit_hash: [u8; 32],
) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, DisputeArbitrationError::Paused);

    let dc = &ctx.accounts.dispute_case;
    require!(
        dc.status == DisputeStatus::Committing,
        DisputeArbitrationError::WrongStatus
    );

    let now = Clock::get()?.unix_timestamp;
    require!(
        now <= dc.commit_deadline,
        DisputeArbitrationError::CommitWindowClosed
    );

    let signer = ctx.accounts.arbitrator_signer.key();
    require!(
        dc.arbitrators.iter().any(|a| *a == signer),
        DisputeArbitrationError::ArbitratorNotSelected
    );

    let vr = &mut ctx.accounts.vote_record;
    vr.case_id = dc.case_id;
    vr.arbitrator = signer;
    vr.round = dc.round;
    vr.commit_hash = commit_hash;
    vr.committed_at = now;
    vr.revealed_verdict = DisputeVerdict::None;
    vr.revealed = false;
    vr.revealed_weight = 0;
    vr.revealed_at = 0;
    vr.bump = ctx.bumps.vote_record;

    emit!(VoteCommitted {
        case_id: dc.case_id,
        arbitrator: signer,
        round: dc.round,
        timestamp: now,
    });
    Ok(())
}

// --- Reveal Vote ---

#[derive(Accounts)]
pub struct RevealVote<'info> {
    #[account(seeds = [SEED_DISPUTE_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, DisputeConfig>>,

    #[account(
        mut,
        seeds = [SEED_DISPUTE_CASE, dispute_case.case_id.to_le_bytes().as_ref()],
        bump = dispute_case.bump,
    )]
    pub dispute_case: Box<Account<'info, DisputeCase>>,

    #[account(
        seeds = [SEED_ARBITRATOR, arbitrator_signer.key().as_ref()],
        bump = arbitrator.bump,
    )]
    pub arbitrator: Box<Account<'info, ArbitratorAccount>>,

    #[account(
        mut,
        seeds = [
            SEED_DISPUTE_VOTE,
            dispute_case.case_id.to_le_bytes().as_ref(),
            arbitrator_signer.key().as_ref(),
            &[dispute_case.round],
        ],
        bump = vote_record.bump,
    )]
    pub vote_record: Box<Account<'info, DisputeVoteRecord>>,

    pub arbitrator_signer: Signer<'info>,
}

pub fn reveal_vote_handler(
    ctx: Context<RevealVote>,
    verdict: DisputeVerdict,
    salt: [u8; 32],
) -> Result<()> {
    let dc = &ctx.accounts.dispute_case;
    require!(
        dc.status == DisputeStatus::Committing || dc.status == DisputeStatus::Revealing,
        DisputeArbitrationError::WrongStatus
    );

    let now = Clock::get()?.unix_timestamp;
    require!(
        now > dc.commit_deadline,
        DisputeArbitrationError::CommitWindowClosed
    );
    require!(
        now <= dc.reveal_deadline,
        DisputeArbitrationError::RevealWindowClosed
    );

    require!(
        verdict != DisputeVerdict::None,
        DisputeArbitrationError::VerdictEncodingInvalid
    );

    let vr = &mut ctx.accounts.vote_record;
    require!(!vr.revealed, DisputeArbitrationError::DuplicateVote);

    let expected = compute_commit_hash(&verdict, &salt);
    require!(
        vr.commit_hash == expected,
        DisputeArbitrationError::CommitHashMismatch
    );

    // weight locked at commit time = arbitrator's effective_stake
    let weight = ctx.accounts.arbitrator.effective_stake as u128;

    vr.revealed_verdict = verdict;
    vr.revealed = true;
    vr.revealed_weight = weight;
    vr.revealed_at = now;

    let case_id = dc.case_id;

    // update tallies on dispute case
    let dc = &mut ctx.accounts.dispute_case;
    if dc.status == DisputeStatus::Committing {
        dc.status = DisputeStatus::Revealing;
    }

    match verdict {
        DisputeVerdict::AgentWins => {
            dc.votes_for_agent = dc.votes_for_agent
                .checked_add(weight)
                .ok_or(DisputeArbitrationError::ArithmeticOverflow)?;
        }
        DisputeVerdict::ClientWins => {
            dc.votes_for_client = dc.votes_for_client
                .checked_add(weight)
                .ok_or(DisputeArbitrationError::ArithmeticOverflow)?;
        }
        DisputeVerdict::Split => {
            dc.votes_for_split = dc.votes_for_split
                .checked_add(weight)
                .ok_or(DisputeArbitrationError::ArithmeticOverflow)?;
        }
        DisputeVerdict::None => unreachable!(),
    }
    dc.total_revealed_weight = dc.total_revealed_weight
        .checked_add(weight)
        .ok_or(DisputeArbitrationError::ArithmeticOverflow)?;

    emit!(VoteRevealed {
        case_id,
        arbitrator: ctx.accounts.arbitrator_signer.key(),
        verdict,
        weight,
        timestamp: now,
    });
    Ok(())
}

// --- Tally Round ---

#[derive(Accounts)]
pub struct TallyRound<'info> {
    #[account(
        mut,
        seeds = [SEED_DISPUTE_CASE, dispute_case.case_id.to_le_bytes().as_ref()],
        bump = dispute_case.bump,
    )]
    pub dispute_case: Box<Account<'info, DisputeCase>>,

    pub cranker: Signer<'info>,
}

pub fn tally_round_handler(ctx: Context<TallyRound>) -> Result<()> {
    let dc = &mut ctx.accounts.dispute_case;
    require!(
        dc.status == DisputeStatus::Revealing,
        DisputeArbitrationError::WrongStatus
    );

    let now = Clock::get()?.unix_timestamp;
    require!(
        now > dc.reveal_deadline,
        DisputeArbitrationError::RevealWindowOpen
    );

    let total = dc.total_revealed_weight;
    let threshold = total / 2;

    let case_id = dc.case_id;
    let round = dc.round;

    let winner = if dc.votes_for_agent > threshold {
        DisputeVerdict::AgentWins
    } else if dc.votes_for_client > threshold {
        DisputeVerdict::ClientWins
    } else if dc.votes_for_split > threshold {
        DisputeVerdict::Split
    } else {
        DisputeVerdict::None
    };

    if winner != DisputeVerdict::None {
        dc.verdict = winner;
        dc.status = DisputeStatus::Tallied;
    } else if dc.round == 1 {
        // no majority in round 1 → auto-appeal for round 2
        dc.round = 2;
        dc.status = DisputeStatus::Appealed;
    } else {
        // round 2 no majority → tallied with None verdict (fallback to reviewer)
        dc.verdict = DisputeVerdict::None;
        dc.status = DisputeStatus::Tallied;
    }

    emit!(RoundTallied {
        case_id,
        round,
        verdict: dc.verdict,
        votes_for_agent: dc.votes_for_agent,
        votes_for_client: dc.votes_for_client,
        votes_for_split: dc.votes_for_split,
        timestamp: now,
    });
    Ok(())
}
