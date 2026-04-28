use anchor_lang::prelude::*;

#[event]
pub struct MintAllowlistInitialized {
    pub authority: Pubkey,
    pub default_deny: bool,
    pub timestamp: i64,
}

// Backward compat alias
pub type HookAllowlistInitialized = MintAllowlistInitialized;

#[event]
pub struct MintAllowlistUpdated {
    pub added: Vec<Pubkey>,
    pub removed: Vec<Pubkey>,
    pub default_deny: bool,
    pub timestamp: i64,
}

pub type HookAllowlistUpdated = MintAllowlistUpdated;

#[event]
pub struct AgentMintAllowlistUpdated {
    pub agent_did: [u8; 32],
    pub added: Vec<Pubkey>,
    pub removed: Vec<Pubkey>,
    pub timestamp: i64,
}

pub type AgentHookAllowlistUpdated = AgentMintAllowlistUpdated;

#[event]
pub struct MintAccepted {
    pub mint: Pubkey,
    pub accept_flags: u32,
    pub has_confidential_transfer: bool,
    pub slot: u64,
    pub timestamp: i64,
}

#[event]
pub struct MintRejected {
    pub mint: Pubkey,
    pub reason: u8,
    pub site: u8,
    pub timestamp: i64,
}

pub type HookRejected = MintRejected;

#[event]
pub struct ConfidentialFeesCollected {
    pub epoch_id: u64,
    pub amount: u64,
    pub collector: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ConfidentialTransfersToggled {
    pub enabled: bool,
    pub authority: Pubkey,
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
pub struct FeeCollectorInitialized {
    pub authority: Pubkey,
    pub saep_mint: Pubkey,
    pub epoch_duration_secs: i64,
    pub timestamp: i64,
}

#[event]
pub struct FeesCollected {
    pub epoch_id: u64,
    pub amount: u64,
    pub collector: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct SlashReceived {
    pub epoch_id: u64,
    pub slasher_program: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct CollateralForfeited {
    pub epoch_id: u64,
    pub source_program: Pubkey,
    pub amount: u64,
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
    pub snapshot_id: u64,
    pub timestamp: i64,
}

#[event]
pub struct DistributionRootCommitted {
    pub epoch_id: u64,
    pub root: [u8; 32],
    pub leaf_count: u32,
    pub total_weight: u64,
    pub committer: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct StakerClaimed {
    pub epoch_id: u64,
    pub staker: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct BurnExecuted {
    pub epoch_id: u64,
    pub amount: u64,
    pub crank: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct EpochSwept {
    pub epoch_id: u64,
    pub residual_staker: u64,
    pub residual_burn: u64,
    pub rolled_to_epoch: u64,
    pub timestamp: i64,
}

#[event]
pub struct DistributionParamsUpdated {
    pub burn_bps: u16,
    pub staker_share_bps: u16,
    pub grant_share_bps: u16,
    pub treasury_share_bps: u16,
    pub timestamp: i64,
}

#[event]
pub struct PausedSet {
    pub paused: bool,
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct SaepDeposited {
    pub depositor: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct SaepWithdrawn {
    pub withdrawer: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}
