#![cfg(test)]

use anchor_lang::AnchorDeserialize;
use proptest::prelude::*;

use crate::state::{
    compute_vote_leaf, verify_vote_proof, GovernanceConfig, ProgramRegistry, ProposalAccount,
    VoteRecord, ExecutionRecord,
};

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        ..ProptestConfig::default()
    })]

    #[test]
    fn arbitrary_bytes_governance_config(data in proptest::collection::vec(any::<u8>(), 0..1024)) {
        let mut slice = data.as_slice();
        let _ = GovernanceConfig::deserialize(&mut slice);
    }

    #[test]
    fn arbitrary_bytes_program_registry(data in proptest::collection::vec(any::<u8>(), 0..2048)) {
        let mut slice = data.as_slice();
        let _ = ProgramRegistry::deserialize(&mut slice);
    }

    #[test]
    fn arbitrary_bytes_proposal_account(data in proptest::collection::vec(any::<u8>(), 0..2048)) {
        let mut slice = data.as_slice();
        let _ = ProposalAccount::deserialize(&mut slice);
    }

    #[test]
    fn arbitrary_bytes_vote_record(data in proptest::collection::vec(any::<u8>(), 0..256)) {
        let mut slice = data.as_slice();
        let _ = VoteRecord::deserialize(&mut slice);
    }

    #[test]
    fn arbitrary_bytes_execution_record(data in proptest::collection::vec(any::<u8>(), 0..256)) {
        let mut slice = data.as_slice();
        let _ = ExecutionRecord::deserialize(&mut slice);
    }

    #[test]
    fn vote_leaf_deterministic(
        voter_bytes in any::<[u8; 32]>(),
        weight in any::<u128>(),
    ) {
        let voter = anchor_lang::prelude::Pubkey::new_from_array(voter_bytes);
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
        let l1 = compute_vote_leaf(&anchor_lang::prelude::Pubkey::new_from_array(v1), weight);
        let l2 = compute_vote_leaf(&anchor_lang::prelude::Pubkey::new_from_array(v2), weight);
        prop_assert_ne!(l1, l2);
    }

    #[test]
    fn bad_proof_rejected(
        voter_bytes in any::<[u8; 32]>(),
        weight in any::<u128>(),
        fake_root in any::<[u8; 32]>(),
    ) {
        let voter = anchor_lang::prelude::Pubkey::new_from_array(voter_bytes);
        let leaf = compute_vote_leaf(&voter, weight);
        prop_assume!(fake_root != leaf);
        prop_assert!(!verify_vote_proof(&[], &fake_root, leaf));
    }
}
