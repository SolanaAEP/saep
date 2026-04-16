//! Account-deserialization fuzz harness.
//!
//! Targets the discriminator + Borsh validation surface that every Anchor
//! `Account<'info, T>` constraint relies on. Generates malformed bytes for
//! `HookAllowlist` and `AgentHookAllowlist` and asserts `try_deserialize`
//! rejects rather than returning garbage.
//!
//! Out of scope: instruction-level owner / signer fuzz — see the BACKLOG
//! "Owner/signer/discriminator fuzz tests" item. SVM-driven layer follows
//! once `cargo-build-sbf` is wired on the host.

use anchor_lang::prelude::*;
use anchor_lang::{AccountDeserialize, AccountSerialize, Discriminator};
use proptest::prelude::*;

use crate::state::{AgentHookAllowlist, HookAllowlist};

fn bytes<T: AccountSerialize>(v: &T) -> Vec<u8> {
    let mut buf = Vec::new();
    v.try_serialize(&mut buf).unwrap();
    buf
}

fn pk(n: u8) -> Pubkey {
    Pubkey::new_from_array([n; 32])
}

fn sample_allowlist() -> HookAllowlist {
    HookAllowlist {
        authority: pk(1),
        pending_authority: Some(pk(2)),
        programs: vec![pk(3), pk(4), pk(5)],
        default_deny: true,
        bump: 254,
    }
}

fn sample_agent_allowlist() -> AgentHookAllowlist {
    AgentHookAllowlist {
        agent_did: [7u8; 32],
        extra_programs: vec![pk(10), pk(11)],
        bump: 253,
    }
}

#[test]
fn allowlist_round_trip() {
    let v = sample_allowlist();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = HookAllowlist::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.authority, v.authority);
    assert_eq!(parsed.pending_authority, v.pending_authority);
    assert_eq!(parsed.programs, v.programs);
    assert_eq!(parsed.default_deny, v.default_deny);
    assert_eq!(parsed.bump, v.bump);
}

#[test]
fn agent_allowlist_round_trip() {
    let v = sample_agent_allowlist();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = AgentHookAllowlist::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.agent_did, v.agent_did);
    assert_eq!(parsed.extra_programs, v.extra_programs);
    assert_eq!(parsed.bump, v.bump);
}

#[test]
fn allowlist_rejects_truncated_to_discriminator_only() {
    let buf = HookAllowlist::DISCRIMINATOR.to_vec();
    let mut slice = buf.as_slice();
    assert!(HookAllowlist::try_deserialize(&mut slice).is_err());
}

#[test]
fn agent_allowlist_rejects_truncated_to_discriminator_only() {
    let buf = AgentHookAllowlist::DISCRIMINATOR.to_vec();
    let mut slice = buf.as_slice();
    assert!(AgentHookAllowlist::try_deserialize(&mut slice).is_err());
}

#[test]
fn all_empty_buffers_rejected() {
    let mut s: &[u8] = &[];
    assert!(HookAllowlist::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(AgentHookAllowlist::try_deserialize(&mut s).is_err());
}

#[test]
fn discriminators_pairwise_distinct() {
    assert_ne!(
        HookAllowlist::DISCRIMINATOR,
        AgentHookAllowlist::DISCRIMINATOR
    );
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        ..ProptestConfig::default()
    })]

    #[test]
    fn allowlist_rejects_arbitrary_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != HookAllowlist::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(HookAllowlist::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn agent_allowlist_rejects_arbitrary_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != AgentHookAllowlist::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(AgentHookAllowlist::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn allowlist_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = HookAllowlist::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = HookAllowlist::try_deserialize(&mut slice);
    }

    #[test]
    fn agent_allowlist_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = AgentHookAllowlist::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = AgentHookAllowlist::try_deserialize(&mut slice);
    }

    #[test]
    fn allowlist_roundtrip_random(
        default_deny in any::<bool>(),
        has_pending in any::<bool>(),
        num_programs in 0usize..=4,
        bump in any::<u8>(),
    ) {
        let programs: Vec<Pubkey> = (0..num_programs).map(|i| pk(i as u8 + 50)).collect();
        let v = HookAllowlist {
            authority: Pubkey::new_unique(),
            pending_authority: if has_pending { Some(Pubkey::new_unique()) } else { None },
            programs,
            default_deny,
            bump,
        };
        let buf = bytes(&v);
        let mut slice = buf.as_slice();
        let parsed = HookAllowlist::try_deserialize(&mut slice).unwrap();
        prop_assert_eq!(parsed.default_deny, default_deny);
        prop_assert_eq!(parsed.pending_authority.is_some(), has_pending);
        prop_assert_eq!(parsed.programs.len(), num_programs);
        prop_assert_eq!(parsed.bump, bump);
    }

    #[test]
    fn allowlist_extra_trailing_bytes_parses_with_unconsumed_slice(
        extra in proptest::collection::vec(any::<u8>(), 1..64),
    ) {
        let v = sample_allowlist();
        let mut buf = bytes(&v);
        buf.extend(extra);
        let mut slice = buf.as_slice();
        let parsed = HookAllowlist::try_deserialize(&mut slice);
        prop_assert!(parsed.is_ok());
        prop_assert!(!slice.is_empty());
    }

    #[test]
    fn allowlist_vec_length_byte_fuzz(
        len_byte_0 in any::<u8>(),
        len_byte_1 in any::<u8>(),
        len_byte_2 in any::<u8>(),
        len_byte_3 in any::<u8>(),
    ) {
        // disc || authority(32) || Option<Pubkey>(1+32) || vec_len_u32_le || ...
        let mut buf: Vec<u8> = HookAllowlist::DISCRIMINATOR.to_vec();
        buf.extend([0u8; 32]); // authority
        buf.push(0); // None for pending_authority
        buf.extend([len_byte_0, len_byte_1, len_byte_2, len_byte_3]);
        buf.extend([0u8; 8]);
        let mut slice = buf.as_slice();
        let _ = HookAllowlist::try_deserialize(&mut slice);
    }
}
