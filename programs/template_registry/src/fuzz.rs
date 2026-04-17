use proptest::prelude::*;
use anchor_lang::prelude::*;
use anchor_lang::{AccountDeserialize, AccountSerialize, Discriminator};

use crate::state::*;

fn proptest_cfg() -> ProptestConfig {
    ProptestConfig::with_cases(512)
}

fn bytes<T: AccountSerialize>(v: &T) -> Vec<u8> {
    let mut buf = Vec::new();
    v.try_serialize(&mut buf).unwrap();
    buf
}

// --- Discriminator tests ---

#[test]
fn discriminators_pairwise_distinct() {
    let discs = [
        TemplateRegistryGlobal::DISCRIMINATOR,
        AgentTemplate::DISCRIMINATOR,
        TemplateFork::DISCRIMINATOR,
        TemplateRental::DISCRIMINATOR,
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
    assert!(TemplateRegistryGlobal::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(AgentTemplate::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(TemplateFork::try_deserialize(&mut s).is_err());
    let mut s: &[u8] = &[];
    assert!(TemplateRental::try_deserialize(&mut s).is_err());
}

#[test]
fn global_round_trip() {
    let v = TemplateRegistryGlobal {
        authority: Pubkey::new_from_array([1u8; 32]),
        pending_authority: None,
        agent_registry: Pubkey::new_from_array([2u8; 32]),
        treasury_standard: Pubkey::new_from_array([3u8; 32]),
        fee_collector: Pubkey::new_from_array([4u8; 32]),
        royalty_cap_bps: 2000,
        platform_fee_bps: 500,
        rent_escrow_mint: Pubkey::new_from_array([5u8; 32]),
        paused: false,
        bump: 254,
    };
    let buf = bytes(&v);
    let mut slice = buf.as_slice();
    let parsed = TemplateRegistryGlobal::try_deserialize(&mut slice).unwrap();
    assert_eq!(parsed.platform_fee_bps, 500);
    assert_eq!(parsed.royalty_cap_bps, 2000);
}

proptest! {
    #![proptest_config(proptest_cfg())]

    #[test]
    fn fuzz_agent_template_roundtrip(
        template_id in prop::array::uniform32(any::<u8>()),
        author in prop::array::uniform32(any::<u8>()),
        config_hash in prop::array::uniform32(any::<u8>()),
        capability_mask in any::<u128>(),
        royalty_bps in 0u16..=MAX_ROYALTY_BPS,
        lineage_depth in 0u8..=MAX_LINEAGE_DEPTH,
        fork_count in any::<u32>(),
        rent_count in any::<u32>(),
        total_revenue in any::<u64>(),
        rent_price in any::<u64>(),
        bump in any::<u8>(),
    ) {
        let t = AgentTemplate {
            template_id,
            author: Pubkey::new_from_array(author),
            config_hash,
            config_uri: [0u8; CONFIG_URI_LEN],
            capability_mask,
            royalty_bps,
            parent_template: None,
            lineage_depth,
            fork_count,
            rent_count,
            total_revenue,
            rent_price_per_sec: rent_price,
            min_rent_duration: 3600,
            max_rent_duration: MAX_RENT_DURATION_SECS,
            status: TemplateStatus::Published,
            created_at: 0,
            updated_at: 0,
            bump,
        };
        let buf = bytes(&t);
        let mut slice = buf.as_slice();
        let decoded = AgentTemplate::try_deserialize(&mut slice).unwrap();
        prop_assert_eq!(decoded.template_id, template_id);
        prop_assert_eq!(decoded.royalty_bps, royalty_bps);
        prop_assert_eq!(decoded.capability_mask, capability_mask);
        prop_assert_eq!(decoded.lineage_depth, lineage_depth);
    }

    #[test]
    fn fuzz_template_rental_roundtrip(
        prepaid in any::<u64>(),
        drip_rate in any::<u64>(),
        claimed_author in any::<u64>(),
        claimed_platform in any::<u64>(),
        bump in any::<u8>(),
        escrow_bump in any::<u8>(),
    ) {
        let r = TemplateRental {
            template: Pubkey::default(),
            renter: Pubkey::default(),
            start_time: 1000,
            end_time: 2000,
            prepaid_amount: prepaid,
            drip_rate_per_sec: drip_rate,
            claimed_author,
            claimed_platform,
            status: RentalStatus::Active,
            bump,
            escrow_bump,
        };
        let buf = bytes(&r);
        let mut slice = buf.as_slice();
        let decoded = TemplateRental::try_deserialize(&mut slice).unwrap();
        prop_assert_eq!(decoded.prepaid_amount, prepaid);
        prop_assert_eq!(decoded.drip_rate_per_sec, drip_rate);
    }

    #[test]
    fn fuzz_template_fork_roundtrip(
        child_did in prop::array::uniform32(any::<u8>()),
        royalty_snapshot in any::<u16>(),
        bump in any::<u8>(),
    ) {
        let f = TemplateFork {
            child_agent_did: child_did,
            parent_template: Pubkey::default(),
            forker: Pubkey::default(),
            royalty_bps_snapshot: royalty_snapshot,
            forked_at: 12345,
            bump,
        };
        let buf = bytes(&f);
        let mut slice = buf.as_slice();
        let decoded = TemplateFork::try_deserialize(&mut slice).unwrap();
        prop_assert_eq!(decoded.child_agent_did, child_did);
        prop_assert_eq!(decoded.royalty_bps_snapshot, royalty_snapshot);
    }

    #[test]
    fn fuzz_arbitrary_bytes_agent_template(data in prop::collection::vec(any::<u8>(), 0..512)) {
        let mut slice = data.as_slice();
        let _ = AgentTemplate::try_deserialize(&mut slice);
    }

    #[test]
    fn fuzz_arbitrary_bytes_rental(data in prop::collection::vec(any::<u8>(), 0..256)) {
        let mut slice = data.as_slice();
        let _ = TemplateRental::try_deserialize(&mut slice);
    }

    #[test]
    fn fuzz_arbitrary_bytes_fork(data in prop::collection::vec(any::<u8>(), 0..256)) {
        let mut slice = data.as_slice();
        let _ = TemplateFork::try_deserialize(&mut slice);
    }

    #[test]
    fn fuzz_arbitrary_bytes_global(data in prop::collection::vec(any::<u8>(), 0..256)) {
        let mut slice = data.as_slice();
        let _ = TemplateRegistryGlobal::try_deserialize(&mut slice);
    }

    #[test]
    fn template_rejects_bad_discriminator(
        disc in any::<[u8; 8]>(),
        tail in prop::collection::vec(any::<u8>(), 0..512),
    ) {
        prop_assume!(disc != AgentTemplate::DISCRIMINATOR);
        let mut buf = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(AgentTemplate::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn rental_rejects_bad_discriminator(
        disc in any::<[u8; 8]>(),
        tail in prop::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != TemplateRental::DISCRIMINATOR);
        let mut buf = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(TemplateRental::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn fork_rejects_bad_discriminator(
        disc in any::<[u8; 8]>(),
        tail in prop::collection::vec(any::<u8>(), 0..256),
    ) {
        prop_assume!(disc != TemplateFork::DISCRIMINATOR);
        let mut buf = disc.to_vec();
        buf.extend(tail);
        let mut slice = buf.as_slice();
        prop_assert!(TemplateFork::try_deserialize(&mut slice).is_err());
    }
}
