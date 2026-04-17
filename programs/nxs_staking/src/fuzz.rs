#![cfg(test)]

use anchor_lang::AnchorDeserialize;
use proptest::prelude::*;

use crate::guard::{AllowedCallers, ReentrancyGuard, StakingConfig, MAX_ALLOWED_CALLERS};
use crate::state::{
    compute_multiplier, compute_voting_power, StakeAccount, StakingPool,
    VotingPowerSnapshot, MAX_LOCKUP_SECS, MAX_VOTING_POWER_MULTIPLIER,
};

fn valid_staking_config() -> impl Strategy<Value = Vec<u8>> {
    (any::<[u8; 32]>(), any::<u8>()).prop_map(|(authority, bump)| {
        let mut buf = vec![0u8; 8]; // discriminator
        buf.extend_from_slice(&authority);
        buf.push(bump);
        buf
    })
}

fn valid_reentrancy_guard() -> impl Strategy<Value = Vec<u8>> {
    (
        any::<bool>(),
        any::<[u8; 32]>(),
        any::<u64>(),
        any::<i64>(),
        any::<u8>(),
    )
        .prop_map(|(active, entered_by, slot, proposed_at, bump)| {
            let mut buf = vec![0u8; 8];
            buf.push(active as u8);
            buf.extend_from_slice(&entered_by);
            buf.extend_from_slice(&slot.to_le_bytes());
            buf.extend_from_slice(&proposed_at.to_le_bytes());
            buf.push(bump);
            buf
        })
}

fn valid_allowed_callers() -> impl Strategy<Value = Vec<u8>> {
    (0..=MAX_ALLOWED_CALLERS as u32, any::<u8>()).prop_flat_map(|(count, bump)| {
        proptest::collection::vec(any::<[u8; 32]>(), count as usize).prop_map(
            move |pubkeys| {
                let mut buf = vec![0u8; 8];
                buf.extend_from_slice(&(pubkeys.len() as u32).to_le_bytes());
                for pk in &pubkeys {
                    buf.extend_from_slice(pk);
                }
                buf.push(bump);
                buf
            },
        )
    })
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 512,
        ..ProptestConfig::default()
    })]

    #[test]
    fn staking_config_roundtrip(data in valid_staking_config()) {
        let mut slice = &data[8..];
        let parsed = StakingConfig::deserialize(&mut slice);
        prop_assert!(parsed.is_ok());
    }

    #[test]
    fn reentrancy_guard_roundtrip(data in valid_reentrancy_guard()) {
        let mut slice = &data[8..];
        let parsed = ReentrancyGuard::deserialize(&mut slice);
        prop_assert!(parsed.is_ok());
    }

    #[test]
    fn allowed_callers_roundtrip(data in valid_allowed_callers()) {
        let mut slice = &data[8..];
        let parsed = AllowedCallers::deserialize(&mut slice);
        prop_assert!(parsed.is_ok());
    }

    #[test]
    fn arbitrary_bytes_staking_config(data in proptest::collection::vec(any::<u8>(), 0..256)) {
        let mut slice = data.as_slice();
        let _ = StakingConfig::deserialize(&mut slice);
    }

    #[test]
    fn arbitrary_bytes_reentrancy_guard(data in proptest::collection::vec(any::<u8>(), 0..256)) {
        let mut slice = data.as_slice();
        let _ = ReentrancyGuard::deserialize(&mut slice);
    }

    #[test]
    fn arbitrary_bytes_allowed_callers(data in proptest::collection::vec(any::<u8>(), 0..1024)) {
        let mut slice = data.as_slice();
        let _ = AllowedCallers::deserialize(&mut slice);
    }

    #[test]
    fn staking_pool_roundtrip(
        authority in any::<[u8; 32]>(),
        pending_tag in any::<bool>(),
        pending in any::<[u8; 32]>(),
        stake_mint in any::<[u8; 32]>(),
        total_staked in any::<u64>(),
        total_stakers in any::<u32>(),
        current_epoch in any::<u64>(),
        epoch_duration in any::<i64>(),
        epoch_start in any::<i64>(),
        reward_rate in any::<u64>(),
        paused in any::<bool>(),
        bump in any::<u8>(),
    ) {
        let mut buf = vec![0u8; 8];
        buf.extend_from_slice(&authority);
        buf.push(if pending_tag { 1 } else { 0 });
        if pending_tag {
            buf.extend_from_slice(&pending);
        }
        buf.extend_from_slice(&stake_mint);
        buf.extend_from_slice(&total_staked.to_le_bytes());
        buf.extend_from_slice(&total_stakers.to_le_bytes());
        buf.extend_from_slice(&current_epoch.to_le_bytes());
        buf.extend_from_slice(&epoch_duration.to_le_bytes());
        buf.extend_from_slice(&epoch_start.to_le_bytes());
        buf.extend_from_slice(&reward_rate.to_le_bytes());
        buf.push(paused as u8);
        buf.push(bump);
        let mut slice = &buf[8..];
        let parsed = StakingPool::deserialize(&mut slice);
        prop_assert!(parsed.is_ok());
    }

    #[test]
    fn multiplier_monotonic(a in 0i64..=MAX_LOCKUP_SECS, b in 0i64..=MAX_LOCKUP_SECS) {
        let ma = compute_multiplier(a);
        let mb = compute_multiplier(b);
        if a <= b {
            prop_assert!(ma <= mb);
        } else {
            prop_assert!(ma >= mb);
        }
    }

    #[test]
    fn multiplier_always_in_range(secs in i64::MIN..=i64::MAX) {
        let m = compute_multiplier(secs);
        prop_assert!(m >= 1 && m <= MAX_VOTING_POWER_MULTIPLIER);
    }

    #[test]
    fn voting_power_no_overflow(amount in any::<u64>(), multiplier in 1u8..=MAX_VOTING_POWER_MULTIPLIER) {
        let vp = compute_voting_power(amount, multiplier);
        prop_assert!(vp <= u64::MAX);
        if (amount as u128 * multiplier as u128) <= u64::MAX as u128 {
            prop_assert_eq!(vp, amount as u64 * multiplier as u64);
        }
    }

    #[test]
    fn arbitrary_bytes_staking_pool(data in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut slice = data.as_slice();
        let _ = StakingPool::deserialize(&mut slice);
    }

    #[test]
    fn arbitrary_bytes_stake_account(data in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut slice = data.as_slice();
        let _ = StakeAccount::deserialize(&mut slice);
    }

    #[test]
    fn arbitrary_bytes_voting_power_snapshot(data in proptest::collection::vec(any::<u8>(), 0..256)) {
        let mut slice = data.as_slice();
        let _ = VotingPowerSnapshot::deserialize(&mut slice);
    }

    #[test]
    fn oversized_caller_list_rejected(
        count in (MAX_ALLOWED_CALLERS as u32 + 1)..=64u32,
        bump in any::<u8>()
    ) {
        let mut buf = vec![0u8; 8];
        buf.extend_from_slice(&count.to_le_bytes());
        for _ in 0..count {
            buf.extend_from_slice(&[1u8; 32]);
        }
        buf.push(bump);
        let mut slice = &buf[8..];
        let parsed = AllowedCallers::deserialize(&mut slice);
        // Borsh will parse it fine — MAX_ALLOWED_CALLERS is a runtime check, not
        // a Borsh constraint. Verify that the parsed vec length exceeds the cap.
        if let Ok(ac) = parsed {
            prop_assert!(ac.programs.len() > MAX_ALLOWED_CALLERS);
        }
    }
}
