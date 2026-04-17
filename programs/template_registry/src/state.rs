use anchor_lang::prelude::*;

pub const MAX_DESCRIPTOR_LEN: usize = 256;
pub const MAX_ROYALTY_BPS: u16 = 2_000;
pub const MAX_RENT_DURATION_SECS: i64 = 30 * 24 * 3_600;
pub const MAX_LINEAGE_DEPTH: u8 = 8;
pub const CONFIG_URI_LEN: usize = 128;

#[account]
#[derive(InitSpace)]
pub struct TemplateRegistryGlobal {
    pub authority: Pubkey,
    pub pending_authority: Option<Pubkey>,
    pub agent_registry: Pubkey,
    pub treasury_standard: Pubkey,
    pub fee_collector: Pubkey,
    pub royalty_cap_bps: u16,
    pub platform_fee_bps: u16,
    pub rent_escrow_mint: Pubkey,
    pub paused: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum TemplateStatus {
    Draft,
    Published,
    Deprecated,
    Retired,
}

#[account]
#[derive(InitSpace)]
pub struct AgentTemplate {
    pub template_id: [u8; 32],
    pub author: Pubkey,
    pub config_hash: [u8; 32],
    pub config_uri: [u8; CONFIG_URI_LEN],
    pub capability_mask: u128,
    pub royalty_bps: u16,
    pub parent_template: Option<Pubkey>,
    pub lineage_depth: u8,
    pub fork_count: u32,
    pub rent_count: u32,
    pub total_revenue: u64,
    pub rent_price_per_sec: u64,
    pub min_rent_duration: i64,
    pub max_rent_duration: i64,
    pub status: TemplateStatus,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct TemplateFork {
    pub child_agent_did: [u8; 32],
    pub parent_template: Pubkey,
    pub forker: Pubkey,
    pub royalty_bps_snapshot: u16,
    pub forked_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum RentalStatus {
    Active,
    Closed,
    Cancelled,
}

#[account]
#[derive(InitSpace)]
pub struct TemplateRental {
    pub template: Pubkey,
    pub renter: Pubkey,
    pub start_time: i64,
    pub end_time: i64,
    pub prepaid_amount: u64,
    pub drip_rate_per_sec: u64,
    pub claimed_author: u64,
    pub claimed_platform: u64,
    pub status: RentalStatus,
    pub bump: u8,
    pub escrow_bump: u8,
}
