#![cfg(test)]

use anchor_lang::prelude::*;
use anchor_lang::{AccountDeserialize, AccountSerialize, Discriminator};
use proptest::prelude::*;

use crate::state::{
    AllowedCallers, ArbitratorAccount, DisputeCase, DisputeConfig, DisputePool,
    DisputeVoteRecord, AppealRecord, PendingSlash, ReentrancyGuard,
    compute_commit_hash, DisputeVerdict,
};

fn bytes<T: AccountSerialize>(v: &T) -> Vec<u8> {
    let mut buf = Vec::new();
    v.try_serialize(&mut buf).unwrap();
    buf
}

fn sample_config() -> DisputeConfig {
    DisputeConfig {
        authority: Pubkey::new_from_array([1u8; 32]),
        pending_authority: Pubkey::default(),
        task_market: Pubkey::new_from_array([2u8; 32]),
        nxs_staking: Pubkey::new_from_array([3u8; 32]),
        fee_collector: Pubkey::new_from_array([4u8; 32]),
        agent_registry: Pubkey::new_from_array([5u8; 32]),
        switchboard_program: Pubkey::new_from_array([6u8; 32]),
        emergency_council: Pubkey::new_from_array([7u8; 32]),
        round1_size: 3,
        round2_size: 5,
        commit_window_secs: 86400,
        reveal_window_secs: 86400,
        appeal_window_secs: 86400,
        appeal_collateral_bps: 15000,
        max_slash_bps: 1000,
        slash_timelock_secs: 2592000,
        min_stake: 1_000_000,
        min_lock_secs: 604800,
        vrf_stale_slots: 150,
        round2_window_secs: 604800,
        bad_faith_threshold: 3,
        bad_faith_lookback: 10,
        next_case_id: 0,
        paused: false,
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

// --- Guard round-trip tests ---

#[test]
fn config_round_trip() {
    let v = sample_config();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = DisputeConfig::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.authority, v.authority);
    assert_eq!(parsed.bump, v.bump);
    assert_eq!(parsed.round1_size, 3);
    assert_eq!(parsed.max_slash_bps, 1000);
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
        ArbitratorAccount::DISCRIMINATOR,
        DisputePool::DISCRIMINATOR,
        DisputeCase::DISCRIMINATOR,
        DisputeVoteRecord::DISCRIMINATOR,
        AppealRecord::DISCRIMINATOR,
        PendingSlash::DISCRIMINATOR,
    ];
    for i in 0..discs.len() {
        for j in (i + 1)..discs.len() {
            assert_ne!(discs[i], discs[j], "discriminator collision at ({}, {})", i, j);
        }
    }
}

// --- Commit-reveal tests ---

#[test]
fn commit_hash_deterministic() {
    let salt = [42u8; 32];
    let h1 = compute_commit_hash(&DisputeVerdict::AgentWins, &salt);
    let h2 = compute_commit_hash(&DisputeVerdict::AgentWins, &salt);
    assert_eq!(h1, h2);
}

#[test]
fn commit_hash_different_verdicts() {
    let salt = [42u8; 32];
    let h1 = compute_commit_hash(&DisputeVerdict::AgentWins, &salt);
    let h2 = compute_commit_hash(&DisputeVerdict::ClientWins, &salt);
    let h3 = compute_commit_hash(&DisputeVerdict::Split, &salt);
    assert_ne!(h1, h2);
    assert_ne!(h2, h3);
    assert_ne!(h1, h3);
}

#[test]
fn commit_hash_different_salts() {
    let h1 = compute_commit_hash(&DisputeVerdict::AgentWins, &[1u8; 32]);
    let h2 = compute_commit_hash(&DisputeVerdict::AgentWins, &[2u8; 32]);
    assert_ne!(h1, h2);
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
    fn arbitrary_bytes_arbitrator(data in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut slice = data.as_slice();
        let _ = ArbitratorAccount::try_deserialize(&mut slice);
    }

    #[test]
    fn arbitrary_bytes_dispute_case(data in proptest::collection::vec(any::<u8>(), 0..2048)) {
        let mut slice = data.as_slice();
        let _ = DisputeCase::try_deserialize(&mut slice);
    }

    #[test]
    fn arbitrary_bytes_vote_record(data in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut slice = data.as_slice();
        let _ = DisputeVoteRecord::try_deserialize(&mut slice);
    }

    #[test]
    fn arbitrary_bytes_appeal_record(data in proptest::collection::vec(any::<u8>(), 0..256)) {
        let mut slice = data.as_slice();
        let _ = AppealRecord::try_deserialize(&mut slice);
    }

    #[test]
    fn arbitrary_bytes_pending_slash(data in proptest::collection::vec(any::<u8>(), 0..256)) {
        let mut slice = data.as_slice();
        let _ = PendingSlash::try_deserialize(&mut slice);
    }

    #[test]
    fn commit_hash_no_collision(
        salt1 in any::<[u8; 32]>(),
        salt2 in any::<[u8; 32]>(),
        v1 in 1u8..4u8,
        v2 in 1u8..4u8,
    ) {
        prop_assume!(salt1 != salt2 || v1 != v2);
        let verdict1 = match v1 {
            1 => DisputeVerdict::AgentWins,
            2 => DisputeVerdict::ClientWins,
            _ => DisputeVerdict::Split,
        };
        let verdict2 = match v2 {
            1 => DisputeVerdict::AgentWins,
            2 => DisputeVerdict::ClientWins,
            _ => DisputeVerdict::Split,
        };
        let h1 = compute_commit_hash(&verdict1, &salt1);
        let h2 = compute_commit_hash(&verdict2, &salt2);
        prop_assert_ne!(h1, h2);
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
}
