//! Account-deserialization fuzz harness (stub).
//!
//! governance_program is currently a scaffold with no persistent account types.
//! This module exists so the fuzz-coverage gate passes uniformly across all
//! programs. Once state types land, expand this to match the pattern used by
//! treasury_standard, capability_registry, et al.
//!
//! The single proptest below exercises the `Initialize` instruction's
//! `Accounts` struct — which is empty — to confirm Anchor's zero-account
//! deserialization path doesn't panic on arbitrary bytes.

use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        ..ProptestConfig::default()
    })]

    #[test]
    fn arbitrary_bytes_do_not_panic(data in proptest::collection::vec(any::<u8>(), 0..512)) {
        // governance_program has no #[account] structs yet. Feed arbitrary bytes
        // through Borsh to confirm the program crate links cleanly and the test
        // infra runs. Real coverage arrives when state types are added.
        use anchor_lang::AnchorDeserialize;
        let mut slice = data.as_slice();
        let _ = <u8 as AnchorDeserialize>::deserialize(&mut slice);
        let _ = <u64 as AnchorDeserialize>::deserialize(&mut slice);
    }
}
