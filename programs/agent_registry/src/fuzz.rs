//! Account-deserialization fuzz harness.
//!
//! Targets the discriminator + Borsh validation surface that every Anchor
//! `Account<'info, T>` constraint relies on. Generates malformed bytes for
//! `RegistryGlobal`, `AgentAccount`, `PersonhoodAttestation`, and
//! `CategoryReputation` and asserts `try_deserialize` rejects rather than
//! returning garbage.
//!
//! Out of scope: instruction-level owner / signer fuzz — see the BACKLOG
//! "Owner/signer/discriminator fuzz tests" item. SVM-driven layer follows
//! once `cargo-build-sbf` is wired on the host.

use anchor_lang::prelude::*;
use anchor_lang::{AccountDeserialize, AccountSerialize, Discriminator};
use proptest::prelude::*;

use crate::state::{
    AgentAccount, AgentStatus, CategoryReputation, PersonhoodAttestation, PersonhoodTier,
    ProviderKind, RegistryGlobal, ReputationScore, MANIFEST_URI_LEN, MAX_GATEKEEPER_NETWORKS,
};

fn bytes<T: AccountSerialize>(v: &T) -> Vec<u8> {
    let mut buf = Vec::new();
    v.try_serialize(&mut buf).unwrap();
    buf
}

fn pk(n: u8) -> Pubkey {
    Pubkey::new_from_array([n; 32])
}

fn sample_global() -> RegistryGlobal {
    RegistryGlobal {
        authority: pk(1),
        pending_authority: Some(pk(2)),
        capability_registry: pk(3),
        task_market: pk(4),
        dispute_arbitration: pk(5),
        slashing_treasury: pk(6),
        stake_mint: pk(7),
        proof_verifier: pk(8),
        min_stake: 1_000_000,
        max_slash_bps: 500,
        slash_timelock_secs: 2_592_000,
        paused: false,
        allowed_civic_networks: [Pubkey::default(); MAX_GATEKEEPER_NETWORKS],
        allowed_civic_networks_len: 0,
        allowed_sas_issuers: [Pubkey::default(); MAX_GATEKEEPER_NETWORKS],
        allowed_sas_issuers_len: 0,
        personhood_basic_min_tier: PersonhoodTier::None,
        require_personhood_for_register: false,
        civic_gateway_program: Pubkey::default(),
        bump: 254,
    }
}

fn sample_agent() -> AgentAccount {
    AgentAccount {
        operator: pk(10),
        agent_id: [1u8; 32],
        did: [2u8; 32],
        manifest_uri: [0u8; MANIFEST_URI_LEN],
        capability_mask: 0xFF,
        price_lamports: 100_000,
        stream_rate: 50,
        reputation: ReputationScore::default(),
        jobs_completed: 0,
        jobs_disputed: 0,
        stake_amount: 1_000_000,
        status: AgentStatus::Active,
        version: 1,
        registered_at: 1_700_000_000,
        last_active: 1_700_000_000,
        delegate: None,
        pending_slash: None,
        pending_withdrawal: None,
        bump: 253,
        vault_bump: 252,
    }
}

fn sample_attestation() -> PersonhoodAttestation {
    PersonhoodAttestation {
        operator: pk(20),
        provider: ProviderKind::Civic,
        tier: PersonhoodTier::Basic,
        gatekeeper_network: pk(21),
        attestation_ref: [3u8; 32],
        attested_at: 1_700_000_000,
        expires_at: 1_703_000_000,
        revoked: false,
        bump: 251,
    }
}

fn sample_category_rep() -> CategoryReputation {
    CategoryReputation {
        agent_did: [4u8; 32],
        capability_bit: 5,
        score: ReputationScore::default(),
        jobs_completed: 10,
        jobs_disputed: 1,
        last_proof_key: [5u8; 32],
        last_task_id: [6u8; 32],
        version: 1,
        bump: 250,
    }
}

#[test]
fn global_round_trip() {
    let v = sample_global();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = RegistryGlobal::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.authority, v.authority);
    assert_eq!(parsed.pending_authority, v.pending_authority);
    assert_eq!(parsed.capability_registry, v.capability_registry);
    assert_eq!(parsed.min_stake, v.min_stake);
    assert_eq!(parsed.max_slash_bps, v.max_slash_bps);
    assert_eq!(parsed.paused, v.paused);
    assert_eq!(parsed.bump, v.bump);
}

#[test]
fn agent_round_trip() {
    let v = sample_agent();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = AgentAccount::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.operator, v.operator);
    assert_eq!(parsed.agent_id, v.agent_id);
    assert_eq!(parsed.did, v.did);
    assert_eq!(parsed.capability_mask, v.capability_mask);
    assert_eq!(parsed.stake_amount, v.stake_amount);
    assert_eq!(parsed.bump, v.bump);
    assert_eq!(parsed.vault_bump, v.vault_bump);
}

#[test]
fn attestation_round_trip() {
    let v = sample_attestation();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = PersonhoodAttestation::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.operator, v.operator);
    assert_eq!(parsed.tier, v.tier);
    assert_eq!(parsed.attestation_ref, v.attestation_ref);
    assert_eq!(parsed.bump, v.bump);
}

#[test]
fn category_rep_round_trip() {
    let v = sample_category_rep();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = CategoryReputation::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.agent_did, v.agent_did);
    assert_eq!(parsed.capability_bit, v.capability_bit);
    assert_eq!(parsed.jobs_completed, v.jobs_completed);
    assert_eq!(parsed.bump, v.bump);
}

#[test]
fn global_rejects_truncated_to_discriminator_only() {
    let buf = RegistryGlobal::DISCRIMINATOR.to_vec();
    let mut slice = buf.as_slice();
    assert!(RegistryGlobal::try_deserialize(&mut slice).is_err());
}

#[test]
fn agent_rejects_truncated_to_discriminator_only() {
    let buf = AgentAccount::DISCRIMINATOR.to_vec();
    let mut slice = buf.as_slice();
    assert!(AgentAccount::try_deserialize(&mut slice).is_err());
}

#[test]
fn attestation_rejects_truncated_to_discriminator_only() {
    let buf = PersonhoodAttestation::DISCRIMINATOR.to_vec();
    let mut slice = buf.as_slice();
    assert!(PersonhoodAttestation::try_deserialize(&mut slice).is_err());
}

#[test]
fn category_rep_rejects_truncated_to_discriminator_only() {
    let buf = CategoryReputation::DISCRIMINATOR.to_vec();
    let mut slice = buf.as_slice();
    assert!(CategoryReputation::try_deserialize(&mut slice).is_err());
}

#[test]
fn all_empty_buffers_rejected() {
    let mut s: &[u8] = &[];
    assert!(RegistryGlobal::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(AgentAccount::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(PersonhoodAttestation::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(CategoryReputation::try_deserialize(&mut s).is_err());
}

#[test]
fn discriminators_pairwise_distinct() {
    let d = [
        RegistryGlobal::DISCRIMINATOR,
        AgentAccount::DISCRIMINATOR,
        PersonhoodAttestation::DISCRIMINATOR,
        CategoryReputation::DISCRIMINATOR,
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
    fn global_rejects_arbitrary_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != RegistryGlobal::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(RegistryGlobal::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn agent_rejects_arbitrary_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != AgentAccount::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(AgentAccount::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn attestation_rejects_arbitrary_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != PersonhoodAttestation::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(PersonhoodAttestation::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn category_rep_rejects_arbitrary_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != CategoryReputation::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(CategoryReputation::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn global_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = RegistryGlobal::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = RegistryGlobal::try_deserialize(&mut slice);
    }

    #[test]
    fn agent_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = AgentAccount::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = AgentAccount::try_deserialize(&mut slice);
    }

    #[test]
    fn attestation_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = PersonhoodAttestation::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = PersonhoodAttestation::try_deserialize(&mut slice);
    }

    #[test]
    fn category_rep_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = CategoryReputation::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = CategoryReputation::try_deserialize(&mut slice);
    }

    #[test]
    fn agent_roundtrip_random(
        capability_mask in any::<u128>(),
        price in any::<u64>(),
        stream_rate in any::<u64>(),
        stake in any::<u64>(),
        jobs_completed in any::<u64>(),
        jobs_disputed in any::<u32>(),
        version in any::<u32>(),
        has_delegate in any::<bool>(),
        bump in any::<u8>(),
        vault_bump in any::<u8>(),
    ) {
        let v = AgentAccount {
            operator: Pubkey::new_unique(),
            agent_id: [1u8; 32],
            did: [2u8; 32],
            manifest_uri: [0u8; MANIFEST_URI_LEN],
            capability_mask,
            price_lamports: price,
            stream_rate,
            reputation: ReputationScore::default(),
            jobs_completed,
            jobs_disputed,
            stake_amount: stake,
            status: AgentStatus::Active,
            version,
            registered_at: 1_700_000_000,
            last_active: 1_700_000_000,
            delegate: if has_delegate { Some(Pubkey::new_unique()) } else { None },
            pending_slash: None,
            pending_withdrawal: None,
            bump,
            vault_bump,
        };
        let buf = bytes(&v);
        let mut slice = buf.as_slice();
        let parsed = AgentAccount::try_deserialize(&mut slice).unwrap();
        prop_assert_eq!(parsed.capability_mask, capability_mask);
        prop_assert_eq!(parsed.price_lamports, price);
        prop_assert_eq!(parsed.stream_rate, stream_rate);
        prop_assert_eq!(parsed.stake_amount, stake);
        prop_assert_eq!(parsed.jobs_completed, jobs_completed);
        prop_assert_eq!(parsed.jobs_disputed, jobs_disputed);
        prop_assert_eq!(parsed.version, version);
        prop_assert_eq!(parsed.delegate.is_some(), has_delegate);
        prop_assert_eq!(parsed.bump, bump);
        prop_assert_eq!(parsed.vault_bump, vault_bump);
    }

    #[test]
    fn attestation_roundtrip_random(
        attested_at in any::<i64>(),
        expires_at in any::<i64>(),
        revoked in any::<bool>(),
        bump in any::<u8>(),
    ) {
        let v = PersonhoodAttestation {
            operator: Pubkey::new_unique(),
            provider: ProviderKind::Civic,
            tier: PersonhoodTier::Basic,
            gatekeeper_network: Pubkey::new_unique(),
            attestation_ref: [7u8; 32],
            attested_at,
            expires_at,
            revoked,
            bump,
        };
        let buf = bytes(&v);
        let mut slice = buf.as_slice();
        let parsed = PersonhoodAttestation::try_deserialize(&mut slice).unwrap();
        prop_assert_eq!(parsed.attested_at, attested_at);
        prop_assert_eq!(parsed.expires_at, expires_at);
        prop_assert_eq!(parsed.revoked, revoked);
        prop_assert_eq!(parsed.bump, bump);
    }

    #[test]
    fn global_extra_trailing_bytes_parses_with_unconsumed_slice(
        extra in proptest::collection::vec(any::<u8>(), 1..64),
    ) {
        let v = sample_global();
        let mut buf = bytes(&v);
        buf.extend(extra);
        let mut slice = buf.as_slice();
        let parsed = RegistryGlobal::try_deserialize(&mut slice);
        prop_assert!(parsed.is_ok());
        prop_assert!(!slice.is_empty());
    }
}
