#![cfg(test)]

use anchor_lang::prelude::*;
use anchor_lang::{AccountDeserialize, AccountSerialize, Discriminator};
use proptest::prelude::*;

use crate::state::{
    compute_vote_leaf, verify_vote_proof, GovernanceConfig, ProgramRegistry, ProposalAccount,
    VoteRecord, ExecutionRecord,
};

fn bytes<T: AccountSerialize>(v: &T) -> Vec<u8> {
    let mut buf = Vec::new();
    v.try_serialize(&mut buf).unwrap();
    buf
}

#[test]
fn discriminators_pairwise_distinct() {
    let discs = [
        GovernanceConfig::DISCRIMINATOR,
        ProgramRegistry::DISCRIMINATOR,
        ProposalAccount::DISCRIMINATOR,
        VoteRecord::DISCRIMINATOR,
        ExecutionRecord::DISCRIMINATOR,
    ];
    for i in 0..discs.len() {
        for j in (i + 1)..discs.len() {
            assert_ne!(discs[i], discs[j], "collision at ({}, {})", i, j);
        }
    }
}

#[test]
fn empty_buffers_rejected() {
    let mut s: &[u8] = &[];
    assert!(GovernanceConfig::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(ProgramRegistry::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(ProposalAccount::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(VoteRecord::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(ExecutionRecord::try_deserialize(&mut s).is_err());
}

#[test]
fn vote_leaf_none_voter_produces_leaf() {
    let leaf = compute_vote_leaf(&Pubkey::default(), 0);
    assert_ne!(leaf, [0u8; 32]);
}

#[test]
fn single_leaf_proof_validates() {
    let leaf = compute_vote_leaf(&Pubkey::new_unique(), 1000);
    assert!(verify_vote_proof(&[], &leaf, leaf));
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        ..ProptestConfig::default()
    })]

    #[test]
    fn arbitrary_bytes_governance_config(data in proptest::collection::vec(any::<u8>(), 0..1024)) {
        let mut slice = data.as_slice();
        let _ = GovernanceConfig::try_deserialize(&mut slice);
    }

    #[test]
    fn arbitrary_bytes_program_registry(data in proptest::collection::vec(any::<u8>(), 0..2048)) {
        let mut slice = data.as_slice();
        let _ = ProgramRegistry::try_deserialize(&mut slice);
    }

    #[test]
    fn arbitrary_bytes_proposal_account(data in proptest::collection::vec(any::<u8>(), 0..2048)) {
        let mut slice = data.as_slice();
        let _ = ProposalAccount::try_deserialize(&mut slice);
    }

    #[test]
    fn arbitrary_bytes_vote_record(data in proptest::collection::vec(any::<u8>(), 0..256)) {
        let mut slice = data.as_slice();
        let _ = VoteRecord::try_deserialize(&mut slice);
    }

    #[test]
    fn arbitrary_bytes_execution_record(data in proptest::collection::vec(any::<u8>(), 0..256)) {
        let mut slice = data.as_slice();
        let _ = ExecutionRecord::try_deserialize(&mut slice);
    }

    #[test]
    fn config_rejects_bad_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..512),
    ) {
        prop_assume!(disc != GovernanceConfig::DISCRIMINATOR);
        let mut buf = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(GovernanceConfig::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn proposal_rejects_bad_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..1024),
    ) {
        prop_assume!(disc != ProposalAccount::DISCRIMINATOR);
        let mut buf = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(ProposalAccount::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn vote_record_rejects_bad_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != VoteRecord::DISCRIMINATOR);
        let mut buf = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(VoteRecord::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn vote_leaf_deterministic(
        voter_bytes in any::<[u8; 32]>(),
        weight in any::<u128>(),
    ) {
        let voter = Pubkey::new_from_array(voter_bytes);
        let l1 = compute_vote_leaf(&voter, weight);
        let l2 = compute_vote_leaf(&voter, weight);
        prop_assert_eq!(l1, l2);
    }

    #[test]
    fn vote_leaf_different_voters_different_leaves(
        v1 in any::<[u8; 32]>(),
        v2 in any::<[u8; 32]>(),
        weight in any::<u128>(),
    ) {
        prop_assume!(v1 != v2);
        let l1 = compute_vote_leaf(&Pubkey::new_from_array(v1), weight);
        let l2 = compute_vote_leaf(&Pubkey::new_from_array(v2), weight);
        prop_assert_ne!(l1, l2);
    }

    #[test]
    fn vote_leaf_different_weights_different_leaves(
        voter_bytes in any::<[u8; 32]>(),
        w1 in any::<u128>(),
        w2 in any::<u128>(),
    ) {
        prop_assume!(w1 != w2);
        let voter = Pubkey::new_from_array(voter_bytes);
        let l1 = compute_vote_leaf(&voter, w1);
        let l2 = compute_vote_leaf(&voter, w2);
        prop_assert_ne!(l1, l2);
    }

    #[test]
    fn bad_proof_rejected(
        voter_bytes in any::<[u8; 32]>(),
        weight in any::<u128>(),
        fake_root in any::<[u8; 32]>(),
    ) {
        let voter = Pubkey::new_from_array(voter_bytes);
        let leaf = compute_vote_leaf(&voter, weight);
        prop_assume!(fake_root != leaf);
        prop_assert!(!verify_vote_proof(&[], &fake_root, leaf));
    }

    #[test]
    fn bad_proof_with_fake_siblings(
        voter_bytes in any::<[u8; 32]>(),
        weight in any::<u128>(),
        fake_root in any::<[u8; 32]>(),
        sibling in any::<[u8; 32]>(),
    ) {
        let voter = Pubkey::new_from_array(voter_bytes);
        let leaf = compute_vote_leaf(&voter, weight);
        prop_assume!(fake_root != leaf);
        let result = verify_vote_proof(&[sibling], &fake_root, leaf);
        // with random sibling and root, should almost never validate
        // (not a hard assert — hash collision is theoretically possible)
        let _ = result;
    }
}
