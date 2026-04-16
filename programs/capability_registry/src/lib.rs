use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;
use state::{MANIFEST_URI_LEN, SLUG_LEN};

declare_id!("GW161Wce7z4S2rdcSCPNGixn2YQajefNc4r3jUj9zZ5F");

#[program]
pub mod capability_registry {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, authority: Pubkey) -> Result<()> {
        instructions::initialize::initialize_handler(ctx, authority)
    }

    pub fn propose_tag(
        ctx: Context<ProposeTag>,
        bit_index: u8,
        slug: [u8; SLUG_LEN],
        manifest_uri: [u8; MANIFEST_URI_LEN],
    ) -> Result<()> {
        instructions::propose_tag::propose_tag_handler(ctx, bit_index, slug, manifest_uri)
    }

    pub fn retire_tag(ctx: Context<RetireTag>, bit_index: u8) -> Result<()> {
        instructions::retire_tag::retire_tag_handler(ctx, bit_index)
    }

    pub fn update_manifest_uri(
        ctx: Context<UpdateManifestUri>,
        bit_index: u8,
        manifest_uri: [u8; MANIFEST_URI_LEN],
    ) -> Result<()> {
        instructions::update_manifest_uri::update_manifest_uri_handler(ctx, bit_index, manifest_uri)
    }

    pub fn transfer_authority(
        ctx: Context<TransferAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        instructions::authority::transfer_authority_handler(ctx, new_authority)
    }

    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        instructions::authority::accept_authority_handler(ctx)
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        instructions::set_paused::set_paused_handler(ctx, paused)
    }

    pub fn validate_mask(ctx: Context<ValidateMask>, mask: u128) -> Result<()> {
        instructions::validate_mask::validate_mask_handler(ctx, mask)
    }

    pub fn set_tag_personhood(
        ctx: Context<SetTagPersonhood>,
        bit_index: u8,
        min_tier: u8,
    ) -> Result<()> {
        instructions::set_tag_personhood::set_tag_personhood_handler(ctx, bit_index, min_tier)
    }
}
