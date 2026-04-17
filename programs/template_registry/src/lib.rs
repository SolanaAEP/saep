use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

#[cfg(test)]
mod fuzz;

use instructions::*;
use state::CONFIG_URI_LEN;

declare_id!("Gkgrk9fUsVN7ssS99jQFLfoRr23PkqJ7h4mdkGArqXyU");

#[program]
pub mod template_registry {
    use super::*;

    pub fn init_global(
        ctx: Context<InitGlobal>,
        agent_registry: Pubkey,
        treasury_standard: Pubkey,
        fee_collector: Pubkey,
        royalty_cap_bps: u16,
        platform_fee_bps: u16,
        rent_escrow_mint: Pubkey,
    ) -> Result<()> {
        instructions::init_global::handler(
            ctx,
            agent_registry,
            treasury_standard,
            fee_collector,
            royalty_cap_bps,
            platform_fee_bps,
            rent_escrow_mint,
        )
    }

    pub fn set_global_params(
        ctx: Context<SetGlobalParams>,
        paused: Option<bool>,
        royalty_cap_bps: Option<u16>,
        platform_fee_bps: Option<u16>,
    ) -> Result<()> {
        instructions::set_global_params::handler(ctx, paused, royalty_cap_bps, platform_fee_bps)
    }

    pub fn mint_template(
        ctx: Context<MintTemplate>,
        template_id: [u8; 32],
        config_hash: [u8; 32],
        config_uri: [u8; CONFIG_URI_LEN],
        capability_mask: u128,
        royalty_bps: u16,
        rent_price_per_sec: u64,
        min_rent_duration: i64,
        max_rent_duration: i64,
    ) -> Result<()> {
        instructions::mint_template::handler(
            ctx,
            template_id,
            config_hash,
            config_uri,
            capability_mask,
            royalty_bps,
            rent_price_per_sec,
            min_rent_duration,
            max_rent_duration,
        )
    }

    pub fn update_template(
        ctx: Context<UpdateTemplate>,
        config_hash: [u8; 32],
        config_uri: [u8; CONFIG_URI_LEN],
    ) -> Result<()> {
        instructions::update_template::handler(ctx, config_hash, config_uri)
    }

    pub fn retire_template(ctx: Context<RetireTemplate>) -> Result<()> {
        instructions::retire_template::handler(ctx)
    }

    pub fn fork_template(
        ctx: Context<ForkTemplate>,
        child_agent_did: [u8; 32],
    ) -> Result<()> {
        instructions::fork_template::handler(ctx, child_agent_did)
    }

    pub fn open_rental(
        ctx: Context<OpenRental>,
        duration_secs: i64,
        rental_nonce: [u8; 8],
    ) -> Result<()> {
        instructions::open_rental::handler(ctx, duration_secs, rental_nonce)
    }

    pub fn claim_rental_revenue(ctx: Context<ClaimRentalRevenue>) -> Result<()> {
        instructions::claim_rental_revenue::handler(ctx)
    }

    pub fn close_rental(ctx: Context<CloseRental>) -> Result<()> {
        instructions::close_rental::handler(ctx)
    }

    pub fn settle_royalty_cpi(ctx: Context<SettleRoyaltyCpi>, gross_amount: u64) -> Result<()> {
        instructions::settle_royalty_cpi::handler(ctx, gross_amount)
    }
}
