use anchor_lang::prelude::*;

#[event]
pub struct HookAllowlistInitialized {
    pub authority: Pubkey,
    pub default_deny: bool,
    pub timestamp: i64,
}

#[event]
pub struct HookAllowlistUpdated {
    pub added: Vec<Pubkey>,
    pub removed: Vec<Pubkey>,
    pub default_deny: bool,
    pub timestamp: i64,
}

#[event]
pub struct AgentHookAllowlistUpdated {
    pub agent_did: [u8; 32],
    pub added: Vec<Pubkey>,
    pub removed: Vec<Pubkey>,
    pub timestamp: i64,
}

#[event]
pub struct MintAccepted {
    pub mint: Pubkey,
    pub accept_flags: u32,
    pub hook_program: Option<Pubkey>,
    pub slot: u64,
    pub timestamp: i64,
}

#[event]
pub struct HookRejected {
    pub mint: Pubkey,
    pub hook_program: Pubkey,
    pub site: u8,
    pub timestamp: i64,
}

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
pub struct FeesCollected {
    pub task_id: [u8; 32],
    pub agent_did: [u8; 32],
    pub operator: Pubkey,
    pub client: Pubkey,
    pub mint: Pubkey,
    pub protocol_fee: u64,
    pub agent_payout: u64,
    pub epoch_id: u64,
    pub timestamp: i64,
}

#[event]
pub struct SlashReceived {
    pub agent_did: [u8; 32],
    pub slasher_program: Pubkey,
    pub amount: u64,
    pub epoch_id: u64,
    pub timestamp: i64,
}

#[event]
pub struct CollateralForfeited {
    pub task_id: [u8; 32],
    pub source_program: Pubkey,
    pub amount: u64,
    pub epoch_id: u64,
    pub timestamp: i64,
}

#[event]
pub struct EpochProcessed {
    pub epoch_id: u64,
    pub total_collected: u64,
    pub burn_amount: u64,
    pub staker_amount: u64,
    pub grant_amount: u64,
    pub treasury_amount: u64,
    pub timestamp: i64,
}
