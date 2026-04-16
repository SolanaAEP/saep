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
