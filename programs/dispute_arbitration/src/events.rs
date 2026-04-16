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
