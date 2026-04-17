use anchor_lang::prelude::*;

use crate::state::{ProposalCategory, ProposalStatus, VoteChoice};

#[event]
pub struct ConfigInitialized {
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ProgramRegistered {
    pub program_id: Pubkey,
    pub label: [u8; 16],
    pub is_critical: bool,
    pub timestamp: i64,
}

#[event]
pub struct ProposalCreated {
    pub proposal_id: u64,
    pub proposer: Pubkey,
    pub category: ProposalCategory,
    pub target_program: Pubkey,
    pub vote_end: i64,
    pub timestamp: i64,
}

#[event]
pub struct VoteCast {
    pub proposal_id: u64,
    pub voter: Pubkey,
    pub choice: VoteChoice,
    pub weight: u128,
    pub timestamp: i64,
}

#[event]
pub struct ProposalFinalized {
    pub proposal_id: u64,
    pub status: ProposalStatus,
    pub for_weight: u128,
    pub against_weight: u128,
    pub abstain_weight: u128,
    pub timestamp: i64,
}

#[event]
pub struct ProposalExecuted {
    pub proposal_id: u64,
    pub cpi_target: Pubkey,
    pub success: bool,
    pub timestamp: i64,
}

#[event]
pub struct ProposalCancelled {
    pub proposal_id: u64,
    pub by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ProposalExpired {
    pub proposal_id: u64,
    pub timestamp: i64,
}

#[event]
pub struct PausedSet {
    pub paused: bool,
    pub authority: Pubkey,
    pub timestamp: i64,
}
