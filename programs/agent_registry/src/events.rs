use anchor_lang::prelude::*;

#[event]
pub struct GlobalInitialized {
    pub authority: Pubkey,
    pub stake_mint: Pubkey,
    pub capability_registry: Pubkey,
    pub task_market: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AgentRegistered {
    pub agent_did: [u8; 32],
    pub operator: Pubkey,
    pub capability_mask: u128,
    pub stake_amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct ManifestUpdated {
    pub agent_did: [u8; 32],
    pub version: u32,
    pub capability_mask: u128,
    pub timestamp: i64,
}

#[event]
pub struct DelegateSet {
    pub agent_did: [u8; 32],
    pub delegate: Option<Pubkey>,
    pub timestamp: i64,
}

#[event]
pub struct StatusChanged {
    pub agent_did: [u8; 32],
    pub new_status: u8,
    pub timestamp: i64,
}

#[event]
pub struct JobOutcomeRecorded {
    pub agent_did: [u8; 32],
    pub success: bool,
    pub disputed: bool,
    pub jobs_completed: u64,
    pub timestamp: i64,
}

#[event]
pub struct StakeIncreased {
    pub agent_did: [u8; 32],
    pub amount: u64,
    pub new_total: u64,
    pub timestamp: i64,
}

#[event]
pub struct WithdrawalRequested {
    pub agent_did: [u8; 32],
    pub amount: u64,
    pub executable_at: i64,
    pub timestamp: i64,
}

#[event]
pub struct WithdrawalExecuted {
    pub agent_did: [u8; 32],
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct SlashProposed {
    pub agent_did: [u8; 32],
    pub amount: u64,
    pub reason_code: u16,
    pub executable_at: i64,
    pub timestamp: i64,
}

#[event]
pub struct SlashCancelled {
    pub agent_did: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct SlashExecuted {
    pub agent_did: [u8; 32],
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct GlobalParamsUpdated {
    pub timestamp: i64,
}

#[event]
pub struct PersonhoodAttested {
    pub operator: Pubkey,
    pub provider: u8,
    pub tier: u8,
    pub expires_at: i64,
    pub timestamp: i64,
}

#[event]
pub struct PersonhoodRevoked {
    pub operator: Pubkey,
    pub reason_code: u16,
    pub timestamp: i64,
}

#[event]
pub struct PersonhoodRefreshed {
    pub operator: Pubkey,
    pub new_expires_at: i64,
    pub timestamp: i64,
}

#[event]
pub struct GatekeeperAllowlistUpdated {
    pub civic_len: u8,
    pub sas_len: u8,
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
pub struct CategoryReputationUpdated {
    pub agent_did: [u8; 32],
    pub capability_bit: u16,
    pub quality: u16,
    pub timeliness: u16,
    pub availability: u16,
    pub cost_efficiency: u16,
    pub honesty: u16,
    pub jobs_completed: u32,
    pub jobs_disputed: u16,
    pub task_id: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct AvailabilityDecayed {
    pub agent_did: [u8; 32],
    pub capability_bit: u16,
    pub old_availability: u16,
    pub new_availability: u16,
    pub miss_count: u8,
    pub timestamp: i64,
}
