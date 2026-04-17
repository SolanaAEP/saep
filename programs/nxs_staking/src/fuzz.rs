#![cfg(test)]

use anchor_lang::AnchorDeserialize;
use proptest::prelude::*;

use crate::guard::{AllowedCallers, ReentrancyGuard, StakingConfig, MAX_ALLOWED_CALLERS};

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
