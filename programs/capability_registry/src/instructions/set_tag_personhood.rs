use anchor_lang::prelude::*;

use crate::errors::CapabilityRegistryError;
use crate::events::TagManifestUpdated;
use crate::state::{CapabilityTag, RegistryConfig, PERSONHOOD_TIER_VERIFIED};

#[derive(Accounts)]
#[instruction(bit_index: u8)]
pub struct SetTagPersonhood<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        has_one = authority @ CapabilityRegistryError::Unauthorized,
    )]
    pub config: Account<'info, RegistryConfig>,

    #[account(
        mut,
        seeds = [b"tag".as_ref(), &[bit_index]],
        bump = tag.bump,
    )]
    pub tag: Account<'info, CapabilityTag>,

    pub authority: Signer<'info>,
}

pub fn set_tag_personhood_handler(
    ctx: Context<SetTagPersonhood>,
    bit_index: u8,
    min_tier: u8,
) -> Result<()> {
    require!(!ctx.accounts.config.paused, CapabilityRegistryError::Paused);
    require!(min_tier <= PERSONHOOD_TIER_VERIFIED, CapabilityRegistryError::InvalidPersonhoodTier);

    let tag = &mut ctx.accounts.tag;
    require!(tag.bit_index == bit_index, CapabilityRegistryError::TagNotFound);
    require!(!tag.retired, CapabilityRegistryError::TagRetired);
    tag.min_personhood_tier = min_tier;

    emit!(TagManifestUpdated { bit_index });
    Ok(())
}
