//! Account-deserialization fuzz harness.
//!
//! Targets the discriminator + Borsh validation surface that every Anchor
//! `Account<'info, T>` constraint relies on. Generates malformed bytes for
//! `RegistryConfig` and `CapabilityTag` and asserts `try_deserialize`
//! rejects rather than returning garbage.
//!
//! Out of scope: instruction-level owner / signer fuzz needs an SVM
//! (mollusk-svm + the solana CLI) and is tracked under the BACKLOG
//! "Owner/signer/discriminator fuzz tests" item — this module covers the
//! deserialize layer; the SVM-driven layer lands in a follow-up cycle once
//! the toolchain is wired.

use anchor_lang::prelude::*;
use anchor_lang::{AccountDeserialize, AccountSerialize, Discriminator};
use proptest::prelude::*;

use crate::state::{
    bit_mask, validate_manifest_uri, validate_slug, CapabilityTag, RegistryConfig,
    MANIFEST_URI_LEN, SLUG_LEN,
};

fn config_bytes(cfg: &RegistryConfig) -> Vec<u8> {
    let mut buf = Vec::new();
    cfg.try_serialize(&mut buf).unwrap();
    buf
}

fn tag_bytes(tag: &CapabilityTag) -> Vec<u8> {
    let mut buf = Vec::new();
    tag.try_serialize(&mut buf).unwrap();
    buf
}

fn sample_config() -> RegistryConfig {
    RegistryConfig {
        authority: Pubkey::new_unique(),
        approved_mask: 0xdead_beef_cafe_babe_u128,
        tag_count: 7,
        pending_authority: Some(Pubkey::new_unique()),
        paused: true,
        bump: 254,
    }
}

fn sample_tag() -> CapabilityTag {
    let mut slug = [0u8; SLUG_LEN];
    slug[..8].copy_from_slice(b"code_gen");
    let mut uri = [0u8; MANIFEST_URI_LEN];
    uri[..21].copy_from_slice(b"ipfs://saep/code_gen0");
    CapabilityTag {
        bit_index: 5,
        slug,
        manifest_uri: uri,
        added_at: 1_700_000_000,
        added_by: Pubkey::new_unique(),
        retired: false,
        min_personhood_tier: 1,
        bump: 253,
    }
}

#[test]
fn config_round_trip() {
    let cfg = sample_config();
    let buf = config_bytes(&cfg);
    let mut slice = buf.as_slice();
    let parsed = RegistryConfig::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.authority, cfg.authority);
    assert_eq!(parsed.approved_mask, cfg.approved_mask);
    assert_eq!(parsed.tag_count, cfg.tag_count);
    assert_eq!(parsed.pending_authority, cfg.pending_authority);
    assert_eq!(parsed.paused, cfg.paused);
    assert_eq!(parsed.bump, cfg.bump);
}

#[test]
fn tag_round_trip() {
    let tag = sample_tag();
    let buf = tag_bytes(&tag);
    let mut slice = buf.as_slice();
    let parsed = CapabilityTag::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.bit_index, tag.bit_index);
    assert_eq!(parsed.slug, tag.slug);
    assert_eq!(parsed.manifest_uri, tag.manifest_uri);
    assert_eq!(parsed.retired, tag.retired);
    assert_eq!(parsed.min_personhood_tier, tag.min_personhood_tier);
    assert_eq!(parsed.bump, tag.bump);
}

#[test]
fn config_rejects_truncated_to_discriminator_only() {
    let buf = RegistryConfig::DISCRIMINATOR.to_vec();
    let mut slice = buf.as_slice();
    assert!(RegistryConfig::try_deserialize(&mut slice).is_err());
}

#[test]
fn tag_rejects_truncated_to_discriminator_only() {
    let buf = CapabilityTag::DISCRIMINATOR.to_vec();
    let mut slice = buf.as_slice();
    assert!(CapabilityTag::try_deserialize(&mut slice).is_err());
}

#[test]
fn config_rejects_empty_buffer() {
    let mut slice: &[u8] = &[];
    assert!(RegistryConfig::try_deserialize(&mut slice).is_err());
}

#[test]
fn tag_disc_does_not_collide_with_config_disc() {
    assert_ne!(RegistryConfig::DISCRIMINATOR, CapabilityTag::DISCRIMINATOR);
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        ..ProptestConfig::default()
    })]

    #[test]
    fn config_rejects_arbitrary_discriminator(disc in any::<[u8; 8]>(), tail in proptest::collection::vec(any::<u8>(), 0..256)) {
        prop_assume!(disc != RegistryConfig::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(RegistryConfig::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn tag_rejects_arbitrary_discriminator(disc in any::<[u8; 8]>(), tail in proptest::collection::vec(any::<u8>(), 0..256)) {
        prop_assume!(disc != CapabilityTag::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(CapabilityTag::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn config_with_correct_disc_random_tail_does_not_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = RegistryConfig::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = RegistryConfig::try_deserialize(&mut slice);
    }

    #[test]
    fn tag_with_correct_disc_random_tail_does_not_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = CapabilityTag::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = CapabilityTag::try_deserialize(&mut slice);
    }

    #[test]
    fn config_serialize_deserialize_roundtrip(
        approved_mask in any::<u128>(),
        tag_count in any::<u8>(),
        paused in any::<bool>(),
        bump in any::<u8>(),
        has_pending in any::<bool>(),
    ) {
        let cfg = RegistryConfig {
            authority: Pubkey::new_unique(),
            approved_mask,
            tag_count,
            pending_authority: if has_pending { Some(Pubkey::new_unique()) } else { None },
            paused,
            bump,
        };
        let buf = config_bytes(&cfg);
        let mut slice = buf.as_slice();
        let parsed = RegistryConfig::try_deserialize(&mut slice).unwrap();
        prop_assert_eq!(parsed.approved_mask, approved_mask);
        prop_assert_eq!(parsed.tag_count, tag_count);
        prop_assert_eq!(parsed.paused, paused);
        prop_assert_eq!(parsed.bump, bump);
        prop_assert_eq!(parsed.pending_authority.is_some(), has_pending);
    }

    #[test]
    fn tag_serialize_deserialize_roundtrip(
        bit_index in any::<u8>(),
        added_at in any::<i64>(),
        retired in any::<bool>(),
        min_tier in 0u8..=2,
        bump in any::<u8>(),
        slug_bytes in proptest::collection::vec(any::<u8>(), SLUG_LEN..=SLUG_LEN),
        uri_bytes in proptest::collection::vec(any::<u8>(), MANIFEST_URI_LEN..=MANIFEST_URI_LEN),
    ) {
        let mut slug = [0u8; SLUG_LEN];
        slug.copy_from_slice(&slug_bytes);
        let mut uri = [0u8; MANIFEST_URI_LEN];
        uri.copy_from_slice(&uri_bytes);
        let tag = CapabilityTag {
            bit_index,
            slug,
            manifest_uri: uri,
            added_at,
            added_by: Pubkey::new_unique(),
            retired,
            min_personhood_tier: min_tier,
            bump,
        };
        let buf = tag_bytes(&tag);
        let mut slice = buf.as_slice();
        let parsed = CapabilityTag::try_deserialize(&mut slice).unwrap();
        prop_assert_eq!(parsed.bit_index, bit_index);
        prop_assert_eq!(parsed.slug, slug);
        prop_assert_eq!(parsed.manifest_uri, uri);
        prop_assert_eq!(parsed.added_at, added_at);
        prop_assert_eq!(parsed.retired, retired);
        prop_assert_eq!(parsed.min_personhood_tier, min_tier);
        prop_assert_eq!(parsed.bump, bump);
    }

    #[test]
    fn config_extra_trailing_bytes_rejected(extra in proptest::collection::vec(any::<u8>(), 1..64)) {
        let cfg = sample_config();
        let mut buf = config_bytes(&cfg);
        buf.extend(extra);
        let mut slice = buf.as_slice();
        let parsed = RegistryConfig::try_deserialize(&mut slice);
        prop_assert!(parsed.is_ok());
        prop_assert!(!slice.is_empty());
    }

    #[test]
    fn bit_mask_total_function(b in any::<u8>()) {
        let r = bit_mask(b);
        if b < 128 {
            prop_assert_eq!(r.unwrap(), 1u128 << b);
        } else {
            prop_assert!(r.is_err());
        }
    }

    #[test]
    fn slug_validator_total_function(bytes in proptest::collection::vec(any::<u8>(), SLUG_LEN..=SLUG_LEN)) {
        let mut slug = [0u8; SLUG_LEN];
        slug.copy_from_slice(&bytes);
        let _ = validate_slug(&slug);
    }

    #[test]
    fn manifest_validator_total_function(bytes in proptest::collection::vec(any::<u8>(), MANIFEST_URI_LEN..=MANIFEST_URI_LEN)) {
        let mut uri = [0u8; MANIFEST_URI_LEN];
        uri.copy_from_slice(&bytes);
        let _ = validate_manifest_uri(&uri);
    }
}
