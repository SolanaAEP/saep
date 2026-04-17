//! Account-deserialization fuzz harness.
//!
//! Targets the discriminator + Borsh validation surface for
//! `DisputeConfig`, `ReentrancyGuard`, and `AllowedCallers`.
//!
//! Out of scope: instruction-level owner / signer fuzz — see the BACKLOG
//! "Owner/signer/discriminator fuzz tests" item. SVM-driven layer follows
//! once `cargo-build-sbf` is wired on the host.

use anchor_lang::prelude::*;
use anchor_lang::{AccountDeserialize, AccountSerialize, Discriminator};
use proptest::prelude::*;

use crate::guard::{AllowedCallers, DisputeConfig, ReentrancyGuard};

fn bytes<T: AccountSerialize>(v: &T) -> Vec<u8> {
    let mut buf = Vec::new();
    v.try_serialize(&mut buf).unwrap();
    buf
}

fn sample_config() -> DisputeConfig {
    DisputeConfig {
        authority: Pubkey::new_from_array([1u8; 32]),
        bump: 254,
    }
}

fn sample_guard() -> ReentrancyGuard {
    ReentrancyGuard {
        active: true,
        entered_by: Pubkey::new_from_array([2u8; 32]),
        entered_at_slot: 42,
        reset_proposed_at: 1_000_000,
        bump: 253,
    }
}

fn sample_allowed() -> AllowedCallers {
    AllowedCallers {
        programs: vec![
            Pubkey::new_from_array([3u8; 32]),
            Pubkey::new_from_array([4u8; 32]),
        ],
        bump: 252,
    }
}

#[test]
fn config_round_trip() {
    let v = sample_config();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = DisputeConfig::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.authority, v.authority);
    assert_eq!(parsed.bump, v.bump);
}

#[test]
fn guard_round_trip() {
    let v = sample_guard();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = ReentrancyGuard::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.active, v.active);
    assert_eq!(parsed.entered_by, v.entered_by);
    assert_eq!(parsed.entered_at_slot, v.entered_at_slot);
    assert_eq!(parsed.reset_proposed_at, v.reset_proposed_at);
    assert_eq!(parsed.bump, v.bump);
}

#[test]
fn allowed_callers_round_trip() {
    let v = sample_allowed();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = AllowedCallers::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.programs, v.programs);
    assert_eq!(parsed.bump, v.bump);
}

#[test]
fn truncated_to_discriminator_rejected() {
    for disc in [
        DisputeConfig::DISCRIMINATOR,
        ReentrancyGuard::DISCRIMINATOR,
        AllowedCallers::DISCRIMINATOR,
    ] {
        let buf = disc.to_vec();
        let mut slice = buf.as_slice();
        assert!(DisputeConfig::try_deserialize(&mut slice).is_err()
            || ReentrancyGuard::try_deserialize(&mut slice).is_err()
            || AllowedCallers::try_deserialize(&mut slice).is_err());
    }
}

#[test]
fn empty_buffers_rejected() {
    let mut s: &[u8] = &[];
    assert!(DisputeConfig::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(ReentrancyGuard::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(AllowedCallers::try_deserialize(&mut s).is_err());
}

#[test]
fn discriminators_pairwise_distinct() {
    let discs = [
        DisputeConfig::DISCRIMINATOR,
        ReentrancyGuard::DISCRIMINATOR,
        AllowedCallers::DISCRIMINATOR,
    ];
    for i in 0..discs.len() {
        for j in (i + 1)..discs.len() {
            assert_ne!(discs[i], discs[j]);
        }
    }
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        ..ProptestConfig::default()
    })]

    #[test]
    fn config_rejects_arbitrary_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != DisputeConfig::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(DisputeConfig::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn guard_rejects_arbitrary_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != ReentrancyGuard::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(ReentrancyGuard::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn allowed_callers_rejects_arbitrary_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != AllowedCallers::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(AllowedCallers::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn config_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = DisputeConfig::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = DisputeConfig::try_deserialize(&mut slice);
    }

    #[test]
    fn guard_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = ReentrancyGuard::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = ReentrancyGuard::try_deserialize(&mut slice);
    }

    #[test]
    fn allowed_callers_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = AllowedCallers::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = AllowedCallers::try_deserialize(&mut slice);
    }

    #[test]
    fn guard_roundtrip_random(
        active in any::<bool>(),
        slot in any::<u64>(),
        proposed_at in any::<i64>(),
        bump in any::<u8>(),
    ) {
        let v = ReentrancyGuard {
            active,
            entered_by: Pubkey::new_unique(),
            entered_at_slot: slot,
            reset_proposed_at: proposed_at,
            bump,
        };
        let buf = bytes(&v);
        let mut slice = buf.as_slice();
        let parsed = ReentrancyGuard::try_deserialize(&mut slice).unwrap();
        prop_assert_eq!(parsed.active, active);
        prop_assert_eq!(parsed.entered_at_slot, slot);
        prop_assert_eq!(parsed.reset_proposed_at, proposed_at);
        prop_assert_eq!(parsed.bump, bump);
    }

    #[test]
    fn allowed_callers_vec_length_byte_fuzz(
        len_byte_0 in any::<u8>(),
        len_byte_1 in any::<u8>(),
        len_byte_2 in any::<u8>(),
        len_byte_3 in any::<u8>(),
    ) {
        let mut buf: Vec<u8> = AllowedCallers::DISCRIMINATOR.to_vec();
        buf.extend([len_byte_0, len_byte_1, len_byte_2, len_byte_3]);
        buf.extend([0u8; 64]);
        let mut slice = buf.as_slice();
        let _ = AllowedCallers::try_deserialize(&mut slice);
    }

    #[test]
    fn config_extra_trailing_bytes_accepted(
        extra in proptest::collection::vec(any::<u8>(), 1..64),
    ) {
        let v = sample_config();
        let mut buf = bytes(&v);
        buf.extend(extra);
        let mut slice = buf.as_slice();
        let parsed = DisputeConfig::try_deserialize(&mut slice);
        prop_assert!(parsed.is_ok());
        prop_assert!(!slice.is_empty());
    }
}
