use anchor_lang::prelude::*;

use crate::state::DisputeVerdict;

#[event]
pub struct GuardEntered {
    pub program: Pubkey,
    pub caller: Pubkey,
    pub slot: u64,
    pub stack_height: u16,
}

#[event]
pub struct ReentrancyRejected {
    pub program: Pubkey,
    pub offending_caller: Pubkey,
    pub slot: u64,
}

#[event]
pub struct GuardInitialized {
    pub program: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct GuardAdminReset {
    pub program: Pubkey,
    pub proposed_at: i64,
    pub executed_at: i64,
}

#[event]
pub struct AllowedCallersUpdated {
    pub program: Pubkey,
    pub count: u16,
    pub timestamp: i64,
}

#[event]
pub struct ArbitratorRegistered {
    pub operator: Pubkey,
    pub effective_stake: u64,
    pub timestamp: i64,
}

#[event]
pub struct PoolSnapshotted {
    pub epoch: u64,
    pub arbitrator_count: u16,
    pub total_staked: u128,
    pub timestamp: i64,
}

#[event]
pub struct DisputeRaised {
    pub case_id: u64,
    pub task_id: u64,
    pub client: Pubkey,
    pub agent_operator: Pubkey,
    pub escrow_amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct ArbitratorsSelected {
    pub case_id: u64,
    pub arbitrators: Vec<Pubkey>,
    pub round: u8,
    pub timestamp: i64,
}

#[event]
pub struct DisputeCancelled {
    pub case_id: u64,
    pub task_id: u64,
    pub timestamp: i64,
}

#[event]
pub struct VoteCommitted {
    pub case_id: u64,
    pub arbitrator: Pubkey,
    pub round: u8,
    pub timestamp: i64,
}

#[event]
pub struct VoteRevealed {
    pub case_id: u64,
    pub arbitrator: Pubkey,
    pub verdict: DisputeVerdict,
    pub weight: u128,
    pub timestamp: i64,
}

#[event]
pub struct RoundTallied {
    pub case_id: u64,
    pub round: u8,
    pub verdict: DisputeVerdict,
    pub votes_for_agent: u128,
    pub votes_for_client: u128,
    pub votes_for_split: u128,
    pub timestamp: i64,
}

#[event]
pub struct AppealEscalated {
    pub case_id: u64,
    pub appellant: Pubkey,
    pub collateral: u64,
    pub timestamp: i64,
}

#[event]
pub struct DisputeResolved {
    pub case_id: u64,
    pub task_id: u64,
    pub verdict: DisputeVerdict,
    pub timestamp: i64,
}

#[event]
pub struct SlashProposed {
    pub arbitrator: Pubkey,
    pub case_id: u64,
    pub amount: u64,
    pub reason_code: u8,
    pub executable_at: i64,
    pub timestamp: i64,
}

#[event]
pub struct SlashExecuted {
    pub arbitrator: Pubkey,
    pub case_id: u64,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct SlashCancelled {
    pub arbitrator: Pubkey,
    pub case_id: u64,
    pub timestamp: i64,
}

#[event]
pub struct ParamsUpdated {
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct PausedSet {
    pub paused: bool,
    pub authority: Pubkey,
    pub timestamp: i64,
}
