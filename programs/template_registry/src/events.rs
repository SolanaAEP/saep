use anchor_lang::prelude::*;

#[event]
pub struct TemplatePublished {
    pub template_id: [u8; 32],
    pub author: Pubkey,
    pub config_hash: [u8; 32],
    pub royalty_bps: u16,
}

#[event]
pub struct TemplateForked {
    pub template_id: [u8; 32],
    pub child_agent_did: [u8; 32],
    pub forker: Pubkey,
    pub royalty_bps_snapshot: u16,
}

#[event]
pub struct RentalOpened {
    pub template: Pubkey,
    pub renter: Pubkey,
    pub start: i64,
    pub end: i64,
    pub prepaid: u64,
}

#[event]
pub struct RentalRevenueClaimed {
    pub rental: Pubkey,
    pub platform_fee: u64,
    pub author_royalty: u64,
    pub renter_retained: u64,
}

#[event]
pub struct RoyaltySettled {
    pub template: Pubkey,
    pub gross: u64,
    pub royalty: u64,
    pub settler: Pubkey,
}

#[event]
pub struct TemplateRetired {
    pub template_id: [u8; 32],
    pub retired_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct RentalClosed {
    pub rental: Pubkey,
    pub refund: u64,
    pub timestamp: i64,
}
