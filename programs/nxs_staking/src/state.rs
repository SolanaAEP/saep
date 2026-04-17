use anchor_lang::prelude::*;

pub const MIN_LOCKUP_SECS: i64 = 7 * 24 * 3_600;       // 7 days
pub const MAX_LOCKUP_SECS: i64 = 365 * 24 * 3_600;      // 1 year
pub const COOLDOWN_SECS: i64 = 3 * 24 * 3_600;           // 3-day unstake cooldown
pub const MAX_VOTING_POWER_MULTIPLIER: u8 = 4;            // max boost for long lockup

#[account]
#[derive(InitSpace)]
pub struct StakingPool {
    pub authority: Pubkey,
    pub pending_authority: Option<Pubkey>,
    pub stake_mint: Pubkey,
    pub total_staked: u64,
    pub total_stakers: u32,
    pub current_epoch: u64,
    pub epoch_duration_secs: i64,
    pub epoch_start_time: i64,
    pub reward_rate_per_epoch: u64,
    pub paused: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum StakeStatus {
    Active,
    Cooldown,
    Withdrawn,
}

#[account]
#[derive(InitSpace)]
pub struct StakeAccount {
    pub owner: Pubkey,
    pub pool: Pubkey,
    pub amount: u64,
    pub lockup_end: i64,
    pub lockup_multiplier: u8,
    pub voting_power: u64,
    pub staked_at: i64,
    pub cooldown_start: i64,
    pub pending_rewards: u64,
    pub last_claim_epoch: u64,
    pub status: StakeStatus,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct VotingPowerSnapshot {
    pub epoch: u64,
    pub total_voting_power: u128,
    pub snapshot_time: i64,
    pub staker_count: u32,
    pub bump: u8,
}

/// Compute voting power multiplier from lockup duration.
/// 7d = 1x, 90d = 2x, 180d = 3x, 365d = 4x (linear interpolation).
pub fn compute_multiplier(lockup_secs: i64) -> u8 {
    if lockup_secs <= MIN_LOCKUP_SECS {
        return 1;
    }
    let range = MAX_LOCKUP_SECS - MIN_LOCKUP_SECS;
    let elapsed = (lockup_secs - MIN_LOCKUP_SECS).min(range);
    let extra = (elapsed as u128 * (MAX_VOTING_POWER_MULTIPLIER as u128 - 1)) / range as u128;
    1 + extra.min(MAX_VOTING_POWER_MULTIPLIER as u128 - 1) as u8
}

pub fn compute_voting_power(amount: u64, multiplier: u8) -> u64 {
    (amount as u128 * multiplier as u128).min(u64::MAX as u128) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multiplier_bounds() {
        assert_eq!(compute_multiplier(MIN_LOCKUP_SECS), 1);
        assert_eq!(compute_multiplier(MAX_LOCKUP_SECS), MAX_VOTING_POWER_MULTIPLIER);
        assert_eq!(compute_multiplier(MAX_LOCKUP_SECS + 100_000), MAX_VOTING_POWER_MULTIPLIER);
        assert_eq!(compute_multiplier(0), 1);
    }

    #[test]
    fn voting_power_math() {
        assert_eq!(compute_voting_power(1_000_000, 4), 4_000_000);
        assert_eq!(compute_voting_power(u64::MAX, 2), u64::MAX);
    }
}
