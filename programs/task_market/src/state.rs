use anchor_lang::prelude::*;

use crate::errors::TaskMarketError;

pub const ALLOWED_MINTS_LEN: usize = 8;
pub const MAX_MILESTONES: u8 = 8;
pub const MAX_PROTOCOL_FEE_BPS: u16 = 100;
pub const MAX_SOLREP_FEE_BPS: u16 = 100;
pub const BPS_DENOM: u128 = 10_000;
pub const CANCEL_GRACE_SECS: i64 = 300;
pub const EXPIRE_GRACE_SECS: i64 = 3_600;
pub const MIN_DEADLINE_SECS: i64 = 60;

#[account]
#[derive(InitSpace)]
pub struct MarketGlobal {
    pub authority: Pubkey,
    pub pending_authority: Option<Pubkey>,
    pub agent_registry: Pubkey,
    pub treasury_standard: Pubkey,
    pub proof_verifier: Pubkey,
    pub fee_collector: Pubkey,
    pub solrep_pool: Pubkey,
    pub protocol_fee_bps: u16,
    pub solrep_fee_bps: u16,
    pub dispute_window_secs: i64,
    pub max_deadline_secs: i64,
    pub allowed_payment_mints: [Pubkey; ALLOWED_MINTS_LEN],
    pub paused: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum TaskStatus {
    Created,
    Funded,
    InExecution,
    ProofSubmitted,
    Verified,
    Released,
    Expired,
    Disputed,
    Resolved,
}

#[account]
#[derive(InitSpace)]
pub struct TaskContract {
    pub task_id: [u8; 32],
    pub client: Pubkey,
    pub agent_did: [u8; 32],
    pub task_nonce: [u8; 8],
    pub payment_mint: Pubkey,
    pub payment_amount: u64,
    pub protocol_fee: u64,
    pub solrep_fee: u64,
    pub task_hash: [u8; 32],
    pub result_hash: [u8; 32],
    pub proof_key: [u8; 32],
    pub criteria_root: [u8; 32],
    pub milestone_count: u8,
    pub milestones_complete: u8,
    pub status: TaskStatus,
    pub created_at: i64,
    pub funded_at: i64,
    pub deadline: i64,
    pub submitted_at: i64,
    pub dispute_window_end: i64,
    pub verified: bool,
    pub bump: u8,
    pub escrow_bump: u8,
}

pub fn is_allowed_mint(list: &[Pubkey; ALLOWED_MINTS_LEN], mint: &Pubkey) -> bool {
    list.iter().any(|m| m == mint)
}

pub fn compute_task_id(client: &Pubkey, task_nonce: &[u8; 8], created_at: i64) -> [u8; 32] {
    // M1: keccak over the canonical tuple. Poseidon2 swap is a no-op field
    // rename for the circuit — hash identity doesn't matter on-chain since the
    // circuit consumes `task_hash`, not `task_id`.
    let mut buf = Vec::with_capacity(32 + 8 + 8);
    buf.extend_from_slice(client.as_ref());
    buf.extend_from_slice(task_nonce);
    buf.extend_from_slice(&created_at.to_le_bytes());
    solana_keccak_hasher::hashv(&[&buf]).to_bytes()
}

pub fn compute_fees(amount: u64, protocol_bps: u16, solrep_bps: u16) -> Result<(u64, u64)> {
    let amt = amount as u128;
    let pf = amt
        .checked_mul(protocol_bps as u128)
        .ok_or(TaskMarketError::ArithmeticOverflow)?
        / BPS_DENOM;
    let sf = amt
        .checked_mul(solrep_bps as u128)
        .ok_or(TaskMarketError::ArithmeticOverflow)?
        / BPS_DENOM;
    let pf: u64 = pf.try_into().map_err(|_| TaskMarketError::ArithmeticOverflow)?;
    let sf: u64 = sf.try_into().map_err(|_| TaskMarketError::ArithmeticOverflow)?;
    let sum = pf
        .checked_add(sf)
        .ok_or(TaskMarketError::ArithmeticOverflow)?;
    require!(sum < amount, TaskMarketError::InvalidAmount);
    Ok((pf, sf))
}

