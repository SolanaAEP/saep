use anchor_lang::prelude::*;

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
pub struct PoolInitialized {
    pub authority: Pubkey,
    pub stake_mint: Pubkey,
    pub epoch_duration_secs: i64,
    pub timestamp: i64,
}

#[event]
pub struct Staked {
    pub owner: Pubkey,
    pub amount: u64,
    pub lockup_end: i64,
    pub voting_power: u64,
    pub multiplier: u8,
    pub timestamp: i64,
}

#[event]
pub struct UnstakeInitiated {
    pub owner: Pubkey,
    pub amount: u64,
    pub cooldown_end: i64,
    pub timestamp: i64,
}

#[event]
pub struct Withdrawn {
    pub owner: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct EpochSnapshotted {
    pub epoch: u64,
    pub total_voting_power: u128,
    pub staker_count: u32,
    pub timestamp: i64,
}

#[event]
pub struct DepositsFrozen {
    pub pool: Pubkey,
    pub authority: Pubkey,
    pub pause_new_stakes_at: i64,
    pub timestamp: i64,
}

#[event]
pub struct DepositsUnfrozen {
    pub pool: Pubkey,
    pub authority: Pubkey,
    pub timestamp: i64,
}
