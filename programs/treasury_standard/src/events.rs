use anchor_lang::prelude::*;

#[event]
pub struct TreasuryGlobalInitialized {
    pub authority: Pubkey,
    pub agent_registry: Pubkey,
    pub jupiter_program: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TreasuryCreated {
    pub agent_did: [u8; 32],
    pub operator: Pubkey,
    pub daily_spend_limit: u64,
    pub per_tx_limit: u64,
    pub weekly_limit: u64,
    pub timestamp: i64,
}

#[event]
pub struct TreasuryFunded {
    pub agent_did: [u8; 32],
    pub mint: Pubkey,
    pub amount: u64,
    pub funder: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TreasuryWithdraw {
    pub agent_did: [u8; 32],
    pub mint: Pubkey,
    pub amount: u64,
    pub normalized_amount: u64,
    pub destination: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct LimitsUpdated {
    pub agent_did: [u8; 32],
    pub daily: u64,
    pub per_tx: u64,
    pub weekly: u64,
    pub timestamp: i64,
}

#[event]
pub struct StreamInitialized {
    pub agent_did: [u8; 32],
    pub client: Pubkey,
    pub payer_mint: Pubkey,
    pub payout_mint: Pubkey,
    pub rate_per_sec: u64,
    pub max_duration: i64,
    pub deposit_total: u64,
    pub timestamp: i64,
}

#[event]
pub struct StreamWithdrawn {
    pub agent_did: [u8; 32],
    pub claimable: u64,
    pub swapped: bool,
    pub timestamp: i64,
}

#[event]
pub struct StreamClosed {
    pub agent_did: [u8; 32],
    pub agent_receipts: u64,
    pub client_refund: u64,
    pub timestamp: i64,
}

#[event]
pub struct AllowedMintAdded {
    pub mint: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AllowedMintRemoved {
    pub mint: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct PausedSet {
    pub paused: bool,
    pub timestamp: i64,
}

#[event]
pub struct SwapExecuted {
    pub agent_did: [u8; 32],
    pub amount_in: u64,
    pub amount_out: u64,
    pub payer_mint: Pubkey,
    pub payout_mint: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AllowedTargetsUpdated {
    pub agent_did: [u8; 32],
    pub added_count: u16,
    pub removed_count: u16,
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
pub struct YieldStrategyRegistered {
    pub strategy_id: [u8; 32],
    pub venue: String,
    pub strategy_program: Pubkey,
    pub underlying_mint: Pubkey,
    pub receipt_mint: Pubkey,
    pub max_allocation_bps: u16,
    pub risk_tier: String,
    pub status: String,
    pub name: String,
    pub metadata_uri: String,
    pub timestamp: i64,
}

#[event]
pub struct YieldStrategyStatusSet {
    pub strategy_id: [u8; 32],
    pub status: String,
    pub timestamp: i64,
}

#[event]
pub struct TreasuryYieldConfigSet {
    pub agent_did: [u8; 32],
    pub strategy_id: [u8; 32],
    pub allocation_bps: u16,
    pub status: String,
    pub timestamp: i64,
}

#[event]
pub struct TreasuryYieldUnwindRequested {
    pub agent_did: [u8; 32],
    pub strategy_id: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct TreasuryYieldAccountingRecorded {
    pub agent_did: [u8; 32],
    pub strategy_id: [u8; 32],
    pub idle_amount: u64,
    pub deployed_amount: u64,
    pub realized_yield_amount: i64,
    pub accounting_slot: u64,
    pub status: String,
    pub timestamp: i64,
}
