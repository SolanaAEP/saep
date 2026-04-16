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
    pub proof_verifier: Pubkey,
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

pub const CATEGORY_REP_VERSION: u8 = 1;
pub const MAX_CAPABILITY_BIT: u16 = 127;
pub const DEFAULT_CATEGORY_ALPHA_BPS: u16 = 2_000;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct ReputationSample {
    pub quality: u16,
    pub timeliness: u16,
    pub availability: u16,
    pub cost_efficiency: u16,
    pub honesty: u16,
    pub disputed: bool,
}

#[account]
#[derive(InitSpace)]
pub struct CategoryReputation {
    pub agent_did: [u8; 32],
    pub capability_bit: u16,
    pub score: ReputationScore,
    pub jobs_completed: u32,
    pub jobs_disputed: u16,
    pub last_proof_key: [u8; 32],
    pub last_task_id: [u8; 32],
    pub version: u8,
    pub bump: u8,
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
    // DEPRECATED: global rolled-up reputation — superseded by per-capability
    // `CategoryReputation` PDAs updated only via `proof_verifier` CPI. Retained
    // for account-layout compatibility; readers should prefer category PDAs.
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

pub fn capability_check(approved_mask: u128, mask: u128) -> Result<()> {
    if (mask & !approved_mask) != 0 {
        return err!(AgentRegistryError::InvalidCapability);
    }
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

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::prelude::*;

    const ALPHA_MAX: u16 = BPS_DENOM as u16;

    proptest! {
        #[test]
        fn ewma_alpha_zero_returns_old(old in any::<u16>(), sample in any::<u16>()) {
            prop_assert_eq!(ewma(old, sample, 0).unwrap(), old);
        }

        #[test]
        fn ewma_alpha_full_returns_sample(old in any::<u16>(), sample in any::<u16>()) {
            prop_assert_eq!(ewma(old, sample, ALPHA_MAX).unwrap(), sample);
        }

        #[test]
        fn ewma_bounded_by_inputs(
            old in any::<u16>(),
            sample in any::<u16>(),
            alpha in 0u16..=ALPHA_MAX,
        ) {
            let r = ewma(old, sample, alpha).unwrap();
            let lo = old.min(sample);
            let hi = old.max(sample);
            prop_assert!(r >= lo && r <= hi);
        }

        #[test]
        fn ewma_alpha_out_of_range_rejected(
            old in any::<u16>(),
            sample in any::<u16>(),
            alpha in (ALPHA_MAX + 1)..=u16::MAX,
        ) {
            prop_assert!(ewma(old, sample, alpha).is_err());
        }

        #[test]
        fn ewma_no_panic_on_extremes(
            alpha in 0u16..=ALPHA_MAX,
        ) {
            let _ = ewma(u16::MAX, u16::MAX, alpha).unwrap();
            let _ = ewma(0, u16::MAX, alpha).unwrap();
            let _ = ewma(u16::MAX, 0, alpha).unwrap();
        }

        #[test]
        fn slash_amount_gt_stake_rejected(
            stake in 0u64..u64::MAX,
            extra in 1u64..=1_000_000u64,
            max_bps in 0u16..=MAX_SLASH_BPS_CAP,
        ) {
            let amount = stake.saturating_add(extra);
            prop_assume!(amount > stake);
            prop_assert!(assert_slash_bound(amount, stake, max_bps).is_err());
        }

        #[test]
        fn slash_within_cap_accepted(
            stake in 1u64..=u64::MAX / (BPS_DENOM as u64),
            ratio_bps in 0u16..=MAX_SLASH_BPS_CAP,
        ) {
            let amount = ((stake as u128) * (ratio_bps as u128) / BPS_DENOM as u128) as u64;
            prop_assert!(assert_slash_bound(amount, stake, MAX_SLASH_BPS_CAP).is_ok());
        }

        #[test]
        fn slash_zero_amount_always_ok(
            stake in any::<u64>(),
            max_bps in 0u16..=MAX_SLASH_BPS_CAP,
        ) {
            prop_assert!(assert_slash_bound(0, stake, max_bps).is_ok());
        }

        #[test]
        fn slash_no_panic_on_extremes(
            amount in any::<u64>(),
            stake in any::<u64>(),
            max_bps in any::<u16>(),
        ) {
            let _ = assert_slash_bound(amount, stake, max_bps);
        }

        #[test]
        fn capability_subset_accepted(
            approved in any::<u128>(),
            mask in any::<u128>(),
        ) {
            let subset = mask & approved;
            prop_assert!(capability_check(approved, subset).is_ok());
        }

        #[test]
        fn capability_extra_bits_rejected(
            approved in any::<u128>(),
            extra in any::<u128>(),
        ) {
            let unapproved = extra & !approved;
            prop_assume!(unapproved != 0);
            let mask = approved | unapproved;
            prop_assert!(capability_check(approved, mask).is_err());
        }

        #[test]
        fn capability_full_mask_accepts_anything(mask in any::<u128>()) {
            prop_assert!(capability_check(u128::MAX, mask).is_ok());
        }
    }
}
