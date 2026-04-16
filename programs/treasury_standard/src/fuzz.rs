//! Account-deserialization fuzz harness.
//!
//! Targets the discriminator + Borsh validation surface that every Anchor
//! `Account<'info, T>` constraint relies on. Generates malformed bytes for the
//! five persistent account types (`TreasuryGlobal`, `AllowedTargets`,
//! `AgentTreasury`, `PaymentStream`, `AllowedMints`) and asserts
//! `try_deserialize` rejects rather than returning garbage.
//!
//! Out of scope: instruction-level owner / signer fuzz — see the BACKLOG
//! "Owner/signer/discriminator fuzz tests" item. SVM-driven layer follows
//! once `cargo-build-sbf` is wired on the host.

use anchor_lang::prelude::*;
use anchor_lang::{AccountDeserialize, AccountSerialize, Discriminator};
use proptest::prelude::*;

use crate::state::{
    AgentTreasury, AllowedMints, AllowedTargets, PaymentStream, StreamStatus, TreasuryGlobal,
};

fn bytes<T: AccountSerialize>(v: &T) -> Vec<u8> {
    let mut buf = Vec::new();
    v.try_serialize(&mut buf).unwrap();
    buf
}

fn pk(n: u8) -> Pubkey {
    Pubkey::new_from_array([n; 32])
}

fn sample_global() -> TreasuryGlobal {
    TreasuryGlobal {
        authority: pk(1),
        pending_authority: Some(pk(2)),
        agent_registry: pk(3),
        jupiter_program: pk(4),
        allowed_mints: pk(5),
        max_stream_duration: 30 * 86_400,
        default_daily_limit: 1_000_000,
        max_daily_limit: 100_000_000,
        paused: false,
        bump: 254,
        global_call_targets: vec![pk(6), pk(7)],
        hook_allowlist: pk(8),
    }
}

fn sample_allowed_targets() -> AllowedTargets {
    AllowedTargets {
        agent_did: [7u8; 32],
        targets: vec![pk(10), pk(11), pk(12)],
        bump: 253,
    }
}

fn sample_agent_treasury() -> AgentTreasury {
    AgentTreasury {
        agent_did: [9u8; 32],
        operator: pk(20),
        daily_spend_limit: 500_000,
        per_tx_limit: 100_000,
        weekly_limit: 2_500_000,
        spent_today: 12_345,
        spent_this_week: 50_000,
        last_reset_day: 19_823,
        last_reset_week: 2_832,
        streaming_active: true,
        stream_counterparty: Some(pk(21)),
        stream_rate_per_sec: 42,
        bump: 252,
    }
}

fn sample_payment_stream() -> PaymentStream {
    PaymentStream {
        agent_did: [11u8; 32],
        client: pk(30),
        payer_mint: pk(31),
        payout_mint: pk(32),
        rate_per_sec: 1_000,
        start_time: 1_700_000_000,
        max_duration: 7 * 86_400,
        deposit_total: 10_000_000,
        withdrawn: 1_000_000,
        escrow_bump: 251,
        status: StreamStatus::Active,
        stream_nonce: [0xAB; 8],
        bump: 250,
    }
}

fn sample_allowed_mints() -> AllowedMints {
    AllowedMints {
        authority: pk(40),
        mints: vec![pk(41), pk(42), pk(43)],
        bump: 249,
    }
}

#[test]
fn global_round_trip() {
    let v = sample_global();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = TreasuryGlobal::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.authority, v.authority);
    assert_eq!(parsed.pending_authority, v.pending_authority);
    assert_eq!(parsed.agent_registry, v.agent_registry);
    assert_eq!(parsed.jupiter_program, v.jupiter_program);
    assert_eq!(parsed.allowed_mints, v.allowed_mints);
    assert_eq!(parsed.max_stream_duration, v.max_stream_duration);
    assert_eq!(parsed.default_daily_limit, v.default_daily_limit);
    assert_eq!(parsed.max_daily_limit, v.max_daily_limit);
    assert_eq!(parsed.paused, v.paused);
    assert_eq!(parsed.bump, v.bump);
    assert_eq!(parsed.global_call_targets, v.global_call_targets);
    assert_eq!(parsed.hook_allowlist, v.hook_allowlist);
}

#[test]
fn allowed_targets_round_trip() {
    let v = sample_allowed_targets();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = AllowedTargets::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.agent_did, v.agent_did);
    assert_eq!(parsed.targets, v.targets);
    assert_eq!(parsed.bump, v.bump);
}

#[test]
fn agent_treasury_round_trip() {
    let v = sample_agent_treasury();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = AgentTreasury::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.agent_did, v.agent_did);
    assert_eq!(parsed.operator, v.operator);
    assert_eq!(parsed.daily_spend_limit, v.daily_spend_limit);
    assert_eq!(parsed.per_tx_limit, v.per_tx_limit);
    assert_eq!(parsed.weekly_limit, v.weekly_limit);
    assert_eq!(parsed.spent_today, v.spent_today);
    assert_eq!(parsed.spent_this_week, v.spent_this_week);
    assert_eq!(parsed.last_reset_day, v.last_reset_day);
    assert_eq!(parsed.last_reset_week, v.last_reset_week);
    assert_eq!(parsed.streaming_active, v.streaming_active);
    assert_eq!(parsed.stream_counterparty, v.stream_counterparty);
    assert_eq!(parsed.stream_rate_per_sec, v.stream_rate_per_sec);
    assert_eq!(parsed.bump, v.bump);
}

#[test]
fn payment_stream_round_trip() {
    let v = sample_payment_stream();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = PaymentStream::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.agent_did, v.agent_did);
    assert_eq!(parsed.client, v.client);
    assert_eq!(parsed.payer_mint, v.payer_mint);
    assert_eq!(parsed.payout_mint, v.payout_mint);
    assert_eq!(parsed.rate_per_sec, v.rate_per_sec);
    assert_eq!(parsed.start_time, v.start_time);
    assert_eq!(parsed.max_duration, v.max_duration);
    assert_eq!(parsed.deposit_total, v.deposit_total);
    assert_eq!(parsed.withdrawn, v.withdrawn);
    assert_eq!(parsed.escrow_bump, v.escrow_bump);
    assert_eq!(parsed.status, v.status);
    assert_eq!(parsed.stream_nonce, v.stream_nonce);
    assert_eq!(parsed.bump, v.bump);
}

#[test]
fn allowed_mints_round_trip() {
    let v = sample_allowed_mints();
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = AllowedMints::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.authority, v.authority);
    assert_eq!(parsed.mints, v.mints);
    assert_eq!(parsed.bump, v.bump);
}

#[test]
fn global_rejects_truncated_to_discriminator_only() {
    let buf = TreasuryGlobal::DISCRIMINATOR.to_vec();
    let mut slice = buf.as_slice();
    assert!(TreasuryGlobal::try_deserialize(&mut slice).is_err());
}

#[test]
fn allowed_targets_rejects_truncated_to_discriminator_only() {
    let buf = AllowedTargets::DISCRIMINATOR.to_vec();
    let mut slice = buf.as_slice();
    assert!(AllowedTargets::try_deserialize(&mut slice).is_err());
}

#[test]
fn agent_treasury_rejects_truncated_to_discriminator_only() {
    let buf = AgentTreasury::DISCRIMINATOR.to_vec();
    let mut slice = buf.as_slice();
    assert!(AgentTreasury::try_deserialize(&mut slice).is_err());
}

#[test]
fn payment_stream_rejects_truncated_to_discriminator_only() {
    let buf = PaymentStream::DISCRIMINATOR.to_vec();
    let mut slice = buf.as_slice();
    assert!(PaymentStream::try_deserialize(&mut slice).is_err());
}

#[test]
fn allowed_mints_rejects_truncated_to_discriminator_only() {
    let buf = AllowedMints::DISCRIMINATOR.to_vec();
    let mut slice = buf.as_slice();
    assert!(AllowedMints::try_deserialize(&mut slice).is_err());
}

#[test]
fn all_empty_buffers_rejected() {
    let mut s: &[u8] = &[];
    assert!(TreasuryGlobal::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(AllowedTargets::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(AgentTreasury::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(PaymentStream::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(AllowedMints::try_deserialize(&mut s).is_err());
}

#[test]
fn discriminators_pairwise_distinct() {
    let d = [
        TreasuryGlobal::DISCRIMINATOR,
        AllowedTargets::DISCRIMINATOR,
        AgentTreasury::DISCRIMINATOR,
        PaymentStream::DISCRIMINATOR,
        AllowedMints::DISCRIMINATOR,
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
        prop_assume!(disc != TreasuryGlobal::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(TreasuryGlobal::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn allowed_targets_rejects_arbitrary_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != AllowedTargets::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(AllowedTargets::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn agent_treasury_rejects_arbitrary_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != AgentTreasury::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(AgentTreasury::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn payment_stream_rejects_arbitrary_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != PaymentStream::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(PaymentStream::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn allowed_mints_rejects_arbitrary_discriminator(
        disc in any::<[u8; 8]>(),
        tail in proptest::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != AllowedMints::DISCRIMINATOR);
        let mut buf: Vec<u8> = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(AllowedMints::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn global_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = TreasuryGlobal::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = TreasuryGlobal::try_deserialize(&mut slice);
    }

    #[test]
    fn allowed_targets_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = AllowedTargets::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = AllowedTargets::try_deserialize(&mut slice);
    }

    #[test]
    fn agent_treasury_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = AgentTreasury::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = AgentTreasury::try_deserialize(&mut slice);
    }

    #[test]
    fn payment_stream_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = PaymentStream::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = PaymentStream::try_deserialize(&mut slice);
    }

    #[test]
    fn allowed_mints_correct_disc_random_tail_no_panic(tail in proptest::collection::vec(any::<u8>(), 0..512)) {
        let mut buf: Vec<u8> = AllowedMints::DISCRIMINATOR.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        let _ = AllowedMints::try_deserialize(&mut slice);
    }

    #[test]
    fn agent_treasury_roundtrip_random(
        daily in any::<u64>(),
        per_tx in any::<u64>(),
        weekly in any::<u64>(),
        spent_today in any::<u64>(),
        spent_week in any::<u64>(),
        last_day in any::<i64>(),
        last_week in any::<i64>(),
        streaming in any::<bool>(),
        has_counterparty in any::<bool>(),
        rate in any::<u64>(),
        bump in any::<u8>(),
    ) {
        let v = AgentTreasury {
            agent_did: [3u8; 32],
            operator: Pubkey::new_unique(),
            daily_spend_limit: daily,
            per_tx_limit: per_tx,
            weekly_limit: weekly,
            spent_today,
            spent_this_week: spent_week,
            last_reset_day: last_day,
            last_reset_week: last_week,
            streaming_active: streaming,
            stream_counterparty: if has_counterparty { Some(Pubkey::new_unique()) } else { None },
            stream_rate_per_sec: rate,
            bump,
        };
        let buf = bytes(&v);
        let mut slice = buf.as_slice();
        let parsed = AgentTreasury::try_deserialize(&mut slice).unwrap();
        prop_assert_eq!(parsed.daily_spend_limit, daily);
        prop_assert_eq!(parsed.per_tx_limit, per_tx);
        prop_assert_eq!(parsed.weekly_limit, weekly);
        prop_assert_eq!(parsed.spent_today, spent_today);
        prop_assert_eq!(parsed.spent_this_week, spent_week);
        prop_assert_eq!(parsed.last_reset_day, last_day);
        prop_assert_eq!(parsed.last_reset_week, last_week);
        prop_assert_eq!(parsed.streaming_active, streaming);
        prop_assert_eq!(parsed.stream_counterparty.is_some(), has_counterparty);
        prop_assert_eq!(parsed.stream_rate_per_sec, rate);
        prop_assert_eq!(parsed.bump, bump);
    }

    #[test]
    fn payment_stream_status_roundtrip(closed in any::<bool>()) {
        let mut v = sample_payment_stream();
        v.status = if closed { StreamStatus::Closed } else { StreamStatus::Active };
        let buf = bytes(&v);
        let mut slice = buf.as_slice();
        let parsed = PaymentStream::try_deserialize(&mut slice).unwrap();
        prop_assert_eq!(parsed.status, v.status);
    }

    #[test]
    fn global_extra_trailing_bytes_parses_with_unconsumed_slice(
        extra in proptest::collection::vec(any::<u8>(), 1..64),
    ) {
        let v = sample_global();
        let mut buf = bytes(&v);
        buf.extend(extra);
        let mut slice = buf.as_slice();
        let parsed = TreasuryGlobal::try_deserialize(&mut slice);
        prop_assert!(parsed.is_ok());
        prop_assert!(!slice.is_empty());
    }

    #[test]
    fn allowed_targets_vec_length_byte_fuzz(
        len_byte_0 in any::<u8>(),
        len_byte_1 in any::<u8>(),
        len_byte_2 in any::<u8>(),
        len_byte_3 in any::<u8>(),
    ) {
        // Prefix `disc || agent_did(32) || vec_len_u32_le` with random length,
        // then minimal tail. Borsh will attempt to read that many Pubkeys off
        // the wire; we only assert no panic on malformed length vs. buffer.
        let mut buf: Vec<u8> = AllowedTargets::DISCRIMINATOR.to_vec();
        buf.extend([0u8; 32]);
        buf.extend([len_byte_0, len_byte_1, len_byte_2, len_byte_3]);
        buf.extend([0u8; 8]);
        let mut slice = buf.as_slice();
        let _ = AllowedTargets::try_deserialize(&mut slice);
    }
}
