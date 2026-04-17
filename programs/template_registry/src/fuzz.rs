use proptest::prelude::*;
use anchor_lang::AnchorDeserialize;

use crate::state::*;

fn proptest_cfg() -> ProptestConfig {
    ProptestConfig::with_cases(512)
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
            author: anchor_lang::prelude::Pubkey::new_from_array(author),
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
        let mut buf = Vec::new();
        anchor_lang::AnchorSerialize::serialize(&t, &mut buf).unwrap();
        let decoded = AgentTemplate::deserialize(&mut &buf[..]).unwrap();
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
            template: anchor_lang::prelude::Pubkey::default(),
            renter: anchor_lang::prelude::Pubkey::default(),
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
        let mut buf = Vec::new();
        anchor_lang::AnchorSerialize::serialize(&r, &mut buf).unwrap();
        let decoded = TemplateRental::deserialize(&mut &buf[..]).unwrap();
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
            parent_template: anchor_lang::prelude::Pubkey::default(),
            forker: anchor_lang::prelude::Pubkey::default(),
            royalty_bps_snapshot: royalty_snapshot,
            forked_at: 12345,
            bump,
        };
        let mut buf = Vec::new();
        anchor_lang::AnchorSerialize::serialize(&f, &mut buf).unwrap();
        let decoded = TemplateFork::deserialize(&mut &buf[..]).unwrap();
        prop_assert_eq!(decoded.child_agent_did, child_did);
        prop_assert_eq!(decoded.royalty_bps_snapshot, royalty_snapshot);
    }

    #[test]
    fn fuzz_arbitrary_bytes_agent_template(data in prop::collection::vec(any::<u8>(), 0..512)) {
        let _ = AgentTemplate::deserialize(&mut &data[..]);
    }

    #[test]
    fn fuzz_arbitrary_bytes_rental(data in prop::collection::vec(any::<u8>(), 0..256)) {
        let _ = TemplateRental::deserialize(&mut &data[..]);
    }

    #[test]
    fn fuzz_arbitrary_bytes_fork(data in prop::collection::vec(any::<u8>(), 0..256)) {
        let _ = TemplateFork::deserialize(&mut &data[..]);
    }
}
