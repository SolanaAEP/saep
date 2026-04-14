use anchor_lang::prelude::*;

use crate::errors::AgentRegistryError;

pub const MANIFEST_URI_LEN: usize = 128;
pub const SLASH_TIMELOCK_SECS: i64 = 2_592_000;
pub const MAX_SLASH_BPS_CAP: u16 = 1_000;
pub const BPS_DENOM: u64 = 10_000;

#[account]
#[derive(InitSpace)]
pub struct RegistryGlobal {
    pub authority: Pubkey,
    pub pending_authority: Option<Pubkey>,
    pub capability_registry: Pubkey,
    pub task_market: Pubkey,
    pub dispute_arbitration: Pubkey,
    pub slashing_treasury: Pubkey,
    pub stake_mint: Pubkey,
    pub min_stake: u64,
    pub max_slash_bps: u16,
    pub slash_timelock_secs: i64,
    pub paused: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum AgentStatus {
    Active,
    Paused,
    Suspended,
    Deregistered,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace)]
pub struct ReputationScore {
    pub quality: u16,
    pub timeliness: u16,
    pub availability: u16,
    pub cost_efficiency: u16,
    pub honesty: u16,
    pub volume: u16,
    pub ewma_alpha_bps: u16,
    pub sample_count: u32,
    pub last_update: i64,
    pub _reserved: [u8; 24],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace)]
pub struct PendingSlash {
    pub amount: u64,
    pub reason_code: u16,
    pub proposed_at: i64,
    pub executable_at: i64,
    pub proposer: Pubkey,
    pub appeal_pending: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace)]
pub struct PendingWithdrawal {
    pub amount: u64,
    pub requested_at: i64,
    pub executable_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct AgentAccount {
    pub operator: Pubkey,
    pub agent_id: [u8; 32],
    pub did: [u8; 32],
    pub manifest_uri: [u8; MANIFEST_URI_LEN],
    pub capability_mask: u128,
    pub price_lamports: u64,
    pub stream_rate: u64,
    pub reputation: ReputationScore,
    pub jobs_completed: u64,
    pub jobs_disputed: u32,
    pub stake_amount: u64,
    pub status: AgentStatus,
    pub version: u32,
    pub registered_at: i64,
    pub last_active: i64,
    pub delegate: Option<Pubkey>,
    pub pending_slash: Option<PendingSlash>,
    pub pending_withdrawal: Option<PendingWithdrawal>,
    pub bump: u8,
    pub vault_bump: u8,
}

pub fn validate_manifest_uri(uri: &[u8; MANIFEST_URI_LEN]) -> Result<()> {
    if uri[0] == 0 {
        return err!(AgentRegistryError::InvalidManifest);
    }
    Ok(())
}

pub fn compute_did(operator: &Pubkey, agent_id: &[u8; 32], manifest_uri: &[u8; MANIFEST_URI_LEN]) -> [u8; 32] {
    let end = manifest_uri.iter().position(|&b| b == 0).unwrap_or(MANIFEST_URI_LEN);
    let preimage = [operator.as_ref(), agent_id.as_ref(), &manifest_uri[..end]].concat();
    solana_keccak_hasher::hashv(&[&preimage]).to_bytes()
}

// CAPABILITY-CHECK-STUB — M2 wires a proper CPI or direct deserialize of
// CapabilityRegistry::RegistryConfig to enforce `mask & !approved_mask == 0`.
pub fn capability_check(_capability_registry: &Pubkey, _mask: u128) -> Result<()> {
    Ok(())
}

pub fn ewma(old: u16, sample: u16, alpha_bps: u16) -> Result<u16> {
    let alpha = alpha_bps as u64;
    if alpha > BPS_DENOM {
        return err!(AgentRegistryError::ReputationOutOfRange);
    }
    let inv = BPS_DENOM.checked_sub(alpha).ok_or(AgentRegistryError::ArithmeticOverflow)?;
    let a = alpha
        .checked_mul(sample as u64)
        .ok_or(AgentRegistryError::ArithmeticOverflow)?;
    let b = inv
        .checked_mul(old as u64)
        .ok_or(AgentRegistryError::ArithmeticOverflow)?;
    let sum = a.checked_add(b).ok_or(AgentRegistryError::ArithmeticOverflow)?;
    Ok((sum / BPS_DENOM) as u16)
}

pub fn assert_slash_bound(amount: u64, stake: u64, max_slash_bps: u16) -> Result<()> {
    if amount > stake {
        return err!(AgentRegistryError::SlashBoundExceeded);
    }
    let lhs = (amount as u128).checked_mul(BPS_DENOM as u128).ok_or(AgentRegistryError::ArithmeticOverflow)?;
    let rhs = (max_slash_bps as u128).checked_mul(stake as u128).ok_or(AgentRegistryError::ArithmeticOverflow)?;
    if lhs > rhs {
        return err!(AgentRegistryError::SlashBoundExceeded);
    }
    Ok(())
}
