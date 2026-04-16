//! Account-deserialization fuzz harness.
//!
//! Targets the discriminator + Borsh validation surface that every Anchor
//! `Account<'info, T>` constraint relies on. Generates malformed bytes for
//! `MarketGlobal`, `TaskContract`, `BidBook`, `Bid`, and `MintAcceptRecord`
//! and asserts `try_deserialize` rejects rather than returning garbage.
//!
//! Out of scope: instruction-level owner / signer fuzz — see the BACKLOG
//! "Owner/signer/discriminator fuzz tests" item. SVM-driven layer follows
//! once `cargo-build-sbf` is wired on the host.

use anchor_lang::prelude::*;
use anchor_lang::{AccountDeserialize, AccountSerialize, Discriminator};
use proptest::prelude::*;

use crate::state::{
    Bid, BidBook, BidPhase, MarketGlobal, MintAcceptRecord, TaskContract, TaskKind, TaskPayload,
    TaskStatus, ALLOWED_MINTS_LEN,
};

fn bytes<T: AccountSerialize>(v: &T) -> Vec<u8> {
    let mut buf = Vec::new();
    v.try_serialize(&mut buf).unwrap();
    buf
}

fn pk(n: u8) -> Pubkey {
    Pubkey::new_from_array([n; 32])
}

fn sample_global() -> MarketGlobal {
    MarketGlobal {
        authority: pk(1),
        pending_authority: Some(pk(2)),
        agent_registry: pk(3),
        treasury_standard: pk(4),
        proof_verifier: pk(5),
        fee_collector: pk(6),
        solrep_pool: pk(7),
        protocol_fee_bps: 50,
        solrep_fee_bps: 50,
        dispute_window_secs: 86_400,
        max_deadline_secs: 30 * 86_400,
        allowed_payment_mints: [Pubkey::default(); ALLOWED_MINTS_LEN],
        paused: false,
        bump: 254,
        hook_allowlist: Pubkey::default(),
    }
}

fn sample_task() -> TaskContract {
    TaskContract {
        task_id: [1u8; 32],
        client: pk(10),
        agent_did: [2u8; 32],
        task_nonce: [3u8; 8],
        payment_mint: pk(11),
        payment_amount: 1_000_000,
        protocol_fee: 5_000,
        solrep_fee: 5_000,
        task_hash: [4u8; 32],
        result_hash: [0u8; 32],
        proof_key: [0u8; 32],
        criteria_root: [0u8; 32],
        milestone_count: 1,
        milestones_complete: 0,
        status: TaskStatus::Created,
        created_at: 1_700_000_000,
        funded_at: 0,
        deadline: 1_700_086_400,
        submitted_at: 0,
        dispute_window_end: 0,
        verified: false,
        bump: 253,
        escrow_bump: 252,
        bid_book: None,
        assigned_agent: None,
        payload: TaskPayload::new(
            TaskKind::Generic {
                capability_bit: 0,
                args_hash: [0u8; 32],
            },
            0,
            vec![],
        ),
    }
}

fn sample_bid_book() -> BidBook {
    BidBook {
        task_id: [1u8; 32],
        commit_start: 1_700_000_000,
        commit_end: 1_700_000_300,
        reveal_end: 1_700_000_480,
        bond_amount: 50_000,
        bond_mint: pk(20),
        commit_count: 3,
        reveal_count: 2,
        winner_agent: None,
        winner_bidder: None,
        winner_amount: 0,
        phase: BidPhase::Commit,
        bump: 251,
        escrow_bump: 250,
    }
}

fn sample_bid() -> Bid {
    Bid {
        task_id: [1u8; 32],
        agent_did: [2u8; 32],
        bidder: pk(30),
        commit_hash: [5u8; 32],
        bond_paid: 50_000,
        revealed_amount: 0,
        revealed: false,
        refunded: false,
        slashed: false,
        bump: 249,
    }
}

fn sample_mint_accept() -> MintAcceptRecord {
    MintAcceptRecord {
        mint: pk(40),
        mint_accept_flags: 0xF,
        hook_program: None,
        accepted_at_slot: 100,
        accepted_at_ts: 1_700_000_000,
        bump: 248,
    }
}

#[test]
fn global_round_trip() {
    let v = sample_global();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = MarketGlobal::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.authority, v.authority);
    assert_eq!(parsed.pending_authority, v.pending_authority);
    assert_eq!(parsed.protocol_fee_bps, v.protocol_fee_bps);
    assert_eq!(parsed.paused, v.paused);
    assert_eq!(parsed.bump, v.bump);
}

#[test]
fn task_round_trip() {
    let v = sample_task();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = TaskContract::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.task_id, v.task_id);
    assert_eq!(parsed.client, v.client);
    assert_eq!(parsed.payment_amount, v.payment_amount);
    assert_eq!(parsed.bump, v.bump);
    assert_eq!(parsed.escrow_bump, v.escrow_bump);
}

#[test]
fn bid_book_round_trip() {
    let v = sample_bid_book();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = BidBook::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.task_id, v.task_id);
    assert_eq!(parsed.bond_amount, v.bond_amount);
    assert_eq!(parsed.commit_count, v.commit_count);
    assert_eq!(parsed.bump, v.bump);
}

#[test]
fn bid_round_trip() {
    let v = sample_bid();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = Bid::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.task_id, v.task_id);
    assert_eq!(parsed.bidder, v.bidder);
    assert_eq!(parsed.bond_paid, v.bond_paid);
    assert_eq!(parsed.bump, v.bump);
}

#[test]
fn mint_accept_round_trip() {
    let v = sample_mint_accept();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = MintAcceptRecord::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.mint, v.mint);
    assert_eq!(parsed.mint_accept_flags, v.mint_accept_flags);
    assert_eq!(parsed.bump, v.bump);
}

#[test]
fn all_truncated_to_discriminator_rejected() {
    let buf = MarketGlobal::DISCRIMINATOR.to_vec();
    let mut slice = buf.as_slice();
    assert!(MarketGlobal::try_deserialize(&mut slice).is_err());

    let buf = TaskContract::DISCRIMINATOR.to_vec();
    let mut slice = buf.as_slice();
    assert!(TaskContract::try_deserialize(&mut slice).is_err());

    let buf = BidBook::DISCRIMINATOR.to_vec();
    let mut slice = buf.as_slice();
    assert!(BidBook::try_deserialize(&mut slice).is_err());

    let buf = Bid::DISCRIMINATOR.to_vec();
    let mut slice = buf.as_slice();
    assert!(Bid::try_deserialize(&mut slice).is_err());

    let buf = MintAcceptRecord::DISCRIMINATOR.to_vec();
    let mut slice = buf.as_slice();
    assert!(MintAcceptRecord::try_deserialize(&mut slice).is_err());
}

#[test]
fn all_empty_buffers_rejected() {
    let mut s: &[u8] = &[];
    assert!(MarketGlobal::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(TaskContract::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(BidBook::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(Bid::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(MintAcceptRecord::try_deserialize(&mut s).is_err());
}

#[test]
fn discriminators_pairwise_distinct() {
    let d = [
        MarketGlobal::DISCRIMINATOR,
        TaskContract::DISCRIMINATOR,
        BidBook::DISCRIMINATOR,
        Bid::DISCRIMINATOR,
        MintAcceptRecord::DISCRIMINATOR,
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
        prop_assume!(disc != MarketGlobal::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(MarketGlobal::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn task_rejects_arbitrary_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != TaskContract::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(TaskContract::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn bid_book_rejects_arbitrary_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != BidBook::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(BidBook::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn bid_rejects_arbitrary_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != Bid::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(Bid::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn mint_accept_rejects_arbitrary_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != MintAcceptRecord::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(MintAcceptRecord::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn global_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = MarketGlobal::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = MarketGlobal::try_deserialize(&mut slice);
    }

    #[test]
    fn task_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = TaskContract::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = TaskContract::try_deserialize(&mut slice);
    }

    #[test]
    fn bid_book_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = BidBook::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = BidBook::try_deserialize(&mut slice);
    }

    #[test]
    fn bid_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = Bid::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = Bid::try_deserialize(&mut slice);
    }

    #[test]
    fn mint_accept_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = MintAcceptRecord::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = MintAcceptRecord::try_deserialize(&mut slice);
    }

    #[test]
    fn bid_roundtrip_random(
        bond_paid in any::<u64>(),
        revealed_amount in any::<u64>(),
        revealed in any::<bool>(),
        refunded in any::<bool>(),
        slashed in any::<bool>(),
        bump in any::<u8>(),
    ) {
        let v = Bid {
            task_id: [1u8; 32],
            agent_did: [2u8; 32],
            bidder: Pubkey::new_unique(),
            commit_hash: [5u8; 32],
            bond_paid,
            revealed_amount,
            revealed,
            refunded,
            slashed,
            bump,
        };
        let buf = bytes(&v);
        let mut slice = buf.as_slice();
        let parsed = Bid::try_deserialize(&mut slice).unwrap();
        prop_assert_eq!(parsed.bond_paid, bond_paid);
        prop_assert_eq!(parsed.revealed_amount, revealed_amount);
        prop_assert_eq!(parsed.revealed, revealed);
        prop_assert_eq!(parsed.refunded, refunded);
        prop_assert_eq!(parsed.slashed, slashed);
        prop_assert_eq!(parsed.bump, bump);
    }

    #[test]
    fn task_roundtrip_random(
        payment_amount in any::<u64>(),
        protocol_fee in any::<u64>(),
        solrep_fee in any::<u64>(),
        milestone_count in any::<u8>(),
        milestones_complete in any::<u8>(),
        verified in any::<bool>(),
        bump in any::<u8>(),
        escrow_bump in any::<u8>(),
    ) {
        let v = TaskContract {
            task_id: [1u8; 32],
            client: Pubkey::new_unique(),
            agent_did: [2u8; 32],
            task_nonce: [3u8; 8],
            payment_mint: Pubkey::new_unique(),
            payment_amount,
            protocol_fee,
            solrep_fee,
            task_hash: [4u8; 32],
            result_hash: [0u8; 32],
            proof_key: [0u8; 32],
            criteria_root: [0u8; 32],
            milestone_count,
            milestones_complete,
            status: TaskStatus::Created,
            created_at: 1_700_000_000,
            funded_at: 0,
            deadline: 1_700_086_400,
            submitted_at: 0,
            dispute_window_end: 0,
            verified,
            bump,
            escrow_bump,
            bid_book: None,
            assigned_agent: None,
            payload: TaskPayload::new(
                TaskKind::Generic { capability_bit: 0, args_hash: [0u8; 32] },
                0,
                vec![],
            ),
        };
        let buf = bytes(&v);
        let mut slice = buf.as_slice();
        let parsed = TaskContract::try_deserialize(&mut slice).unwrap();
        prop_assert_eq!(parsed.payment_amount, payment_amount);
        prop_assert_eq!(parsed.protocol_fee, protocol_fee);
        prop_assert_eq!(parsed.solrep_fee, solrep_fee);
        prop_assert_eq!(parsed.milestone_count, milestone_count);
        prop_assert_eq!(parsed.milestones_complete, milestones_complete);
        prop_assert_eq!(parsed.verified, verified);
        prop_assert_eq!(parsed.bump, bump);
        prop_assert_eq!(parsed.escrow_bump, escrow_bump);
    }

    #[test]
    fn global_extra_trailing_bytes_parses_with_unconsumed_slice(
        extra in proptest::collection::vec(any::<u8>(), 1..64),
    ) {
        let v = sample_global();
        let mut buf = bytes(&v);
        buf.extend(extra);
        let mut slice = buf.as_slice();
        let parsed = MarketGlobal::try_deserialize(&mut slice);
        prop_assert!(parsed.is_ok());
        prop_assert!(!slice.is_empty());
    }
}
