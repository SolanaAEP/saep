//! Account-deserialization fuzz harness.
//!
//! Targets the discriminator + Borsh validation surface that every Anchor
//! `Account<'info, T>` constraint relies on. Generates malformed bytes for
//! `VerifierConfig`, `VerifierKey`, `GlobalMode`, and `BatchState` and asserts
//! `try_deserialize` rejects rather than returning garbage.
//!
//! Out of scope: instruction-level owner / signer fuzz — see the BACKLOG
//! "Owner/signer/discriminator fuzz tests" item. SVM-driven layer follows
//! once `cargo-build-sbf` is wired on the host.

use anchor_lang::prelude::*;
use anchor_lang::{AccountDeserialize, AccountSerialize, Discriminator};
use proptest::prelude::*;

use crate::state::{BatchState, GlobalMode, VerifierConfig, VerifierKey, scalar_in_field};

fn bytes<T: AccountSerialize>(v: &T) -> Vec<u8> {
    let mut buf = Vec::new();
    v.try_serialize(&mut buf).unwrap();
    buf
}

fn pk(n: u8) -> Pubkey {
    Pubkey::new_from_array([n; 32])
}

fn sample_config() -> VerifierConfig {
    VerifierConfig {
        authority: pk(1),
        pending_authority: Some(pk(2)),
        active_vk: pk(3),
        pending_vk: None,
        pending_activates_at: 0,
        paused: false,
        bump: 254,
    }
}

fn sample_vk() -> VerifierKey {
    VerifierKey {
        vk_id: [1u8; 32],
        alpha_g1: [2u8; 64],
        beta_g2: [3u8; 128],
        gamma_g2: [4u8; 128],
        delta_g2: [5u8; 128],
        ic: vec![[6u8; 64], [7u8; 64]],
        num_public_inputs: 1,
        circuit_label: [8u8; 32],
        is_production: false,
        registered_at: 1_700_000_000,
        registered_by: pk(10),
        bump: 253,
    }
}

fn sample_global_mode() -> GlobalMode {
    GlobalMode {
        is_mainnet: false,
        bump: 252,
    }
}

fn sample_batch() -> BatchState {
    BatchState {
        cranker: pk(20),
        vk_key: pk(21),
        batch_id: [9u8; 16],
        count: 0,
        max_proofs: 5,
        acc_alpha: [0u8; 64],
        acc_vk_x: [0u8; 64],
        acc_c: [0u8; 64],
        random_state: [0u8; 32],
        neg_a_scaled: vec![],
        b_points: vec![],
        bump: 251,
    }
}

#[test]
fn config_round_trip() {
    let v = sample_config();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = VerifierConfig::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.authority, v.authority);
    assert_eq!(parsed.pending_authority, v.pending_authority);
    assert_eq!(parsed.active_vk, v.active_vk);
    assert_eq!(parsed.paused, v.paused);
    assert_eq!(parsed.bump, v.bump);
}

#[test]
fn vk_round_trip() {
    let v = sample_vk();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = VerifierKey::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.vk_id, v.vk_id);
    assert_eq!(parsed.num_public_inputs, v.num_public_inputs);
    assert_eq!(parsed.ic.len(), v.ic.len());
    assert_eq!(parsed.bump, v.bump);
}

#[test]
fn global_mode_round_trip() {
    let v = sample_global_mode();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = GlobalMode::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.is_mainnet, v.is_mainnet);
    assert_eq!(parsed.bump, v.bump);
}

#[test]
fn batch_round_trip() {
    let v = sample_batch();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = BatchState::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.cranker, v.cranker);
    assert_eq!(parsed.batch_id, v.batch_id);
    assert_eq!(parsed.count, v.count);
    assert_eq!(parsed.max_proofs, v.max_proofs);
    assert_eq!(parsed.bump, v.bump);
}

#[test]
fn all_truncated_to_discriminator_rejected() {
    let buf = VerifierConfig::DISCRIMINATOR.to_vec();
    let mut slice = buf.as_slice();
    assert!(VerifierConfig::try_deserialize(&mut slice).is_err());

    let buf = VerifierKey::DISCRIMINATOR.to_vec();
    let mut slice = buf.as_slice();
    assert!(VerifierKey::try_deserialize(&mut slice).is_err());

    let buf = GlobalMode::DISCRIMINATOR.to_vec();
    let mut slice = buf.as_slice();
    assert!(GlobalMode::try_deserialize(&mut slice).is_err());

    let buf = BatchState::DISCRIMINATOR.to_vec();
    let mut slice = buf.as_slice();
    assert!(BatchState::try_deserialize(&mut slice).is_err());
}

#[test]
fn all_empty_buffers_rejected() {
    let mut s: &[u8] = &[];
    assert!(VerifierConfig::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(VerifierKey::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(GlobalMode::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(BatchState::try_deserialize(&mut s).is_err());
}

#[test]
fn discriminators_pairwise_distinct() {
    let d = [
        VerifierConfig::DISCRIMINATOR,
        VerifierKey::DISCRIMINATOR,
        GlobalMode::DISCRIMINATOR,
        BatchState::DISCRIMINATOR,
    ];
    for i in 0..d.len() {
        for j in (i + 1)..d.len() {
            assert_ne!(d[i], d[j], "discriminator collision: {i} vs {j}");
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
        prop_assume!(disc != VerifierConfig::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(VerifierConfig::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn vk_rejects_arbitrary_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != VerifierKey::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(VerifierKey::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn global_mode_rejects_arbitrary_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != GlobalMode::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(GlobalMode::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn batch_rejects_arbitrary_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != BatchState::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(BatchState::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn config_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = VerifierConfig::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = VerifierConfig::try_deserialize(&mut slice);
    }

    #[test]
    fn vk_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = VerifierKey::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = VerifierKey::try_deserialize(&mut slice);
    }

    #[test]
    fn global_mode_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = GlobalMode::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = GlobalMode::try_deserialize(&mut slice);
    }

    #[test]
    fn batch_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = BatchState::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = BatchState::try_deserialize(&mut slice);
    }

    #[test]
    fn config_roundtrip_random(
        paused in any::<bool>(),
        has_pending_auth in any::<bool>(),
        has_pending_vk in any::<bool>(),
        pending_activates_at in any::<i64>(),
        bump in any::<u8>(),
    ) {
        let v = VerifierConfig {
            authority: Pubkey::new_unique(),
            pending_authority: if has_pending_auth { Some(Pubkey::new_unique()) } else { None },
            active_vk: Pubkey::new_unique(),
            pending_vk: if has_pending_vk { Some(Pubkey::new_unique()) } else { None },
            pending_activates_at,
            paused,
            bump,
        };
        let buf = bytes(&v);
        let mut slice = buf.as_slice();
        let parsed = VerifierConfig::try_deserialize(&mut slice).unwrap();
        prop_assert_eq!(parsed.paused, paused);
        prop_assert_eq!(parsed.pending_authority.is_some(), has_pending_auth);
        prop_assert_eq!(parsed.pending_vk.is_some(), has_pending_vk);
        prop_assert_eq!(parsed.pending_activates_at, pending_activates_at);
        prop_assert_eq!(parsed.bump, bump);
    }

    #[test]
    fn global_mode_roundtrip_random(is_mainnet in any::<bool>(), bump in any::<u8>()) {
        let v = GlobalMode { is_mainnet, bump };
        let buf = bytes(&v);
        let mut slice = buf.as_slice();
        let parsed = GlobalMode::try_deserialize(&mut slice).unwrap();
        prop_assert_eq!(parsed.is_mainnet, is_mainnet);
        prop_assert_eq!(parsed.bump, bump);
    }

    #[test]
    fn config_extra_trailing_bytes_parses_with_unconsumed_slice(
        extra in proptest::collection::vec(any::<u8>(), 1..64),
    ) {
        let v = sample_config();
        let mut buf = bytes(&v);
        buf.extend(extra);
        let mut slice = buf.as_slice();
        let parsed = VerifierConfig::try_deserialize(&mut slice);
        prop_assert!(parsed.is_ok());
        prop_assert!(!slice.is_empty());
    }

    #[test]
    fn scalar_in_field_total_function(scalar in any::<[u8; 32]>()) {
        let _ = scalar_in_field(&scalar);
    }

    #[test]
    fn vk_ic_vec_length_byte_fuzz(
        len_byte_0 in any::<u8>(),
        len_byte_1 in any::<u8>(),
        len_byte_2 in any::<u8>(),
        len_byte_3 in any::<u8>(),
    ) {
        // disc || fixed fields || vec_len_u32_le with random length, minimal tail.
        // Borsh will attempt to read that many [u8;64] off the wire; assert no panic.
        let mut buf: Vec<u8> = VerifierKey::DISCRIMINATOR.to_vec();
        buf.extend([0u8; 32]); // vk_id
        buf.extend([0u8; 64]); // alpha_g1
        buf.extend([0u8; 128]); // beta_g2
        buf.extend([0u8; 128]); // gamma_g2
        buf.extend([0u8; 128]); // delta_g2
        buf.extend([len_byte_0, len_byte_1, len_byte_2, len_byte_3]); // ic vec len
        buf.extend([0u8; 16]);
        let mut slice = buf.as_slice();
        let _ = VerifierKey::try_deserialize(&mut slice);
    }
}
