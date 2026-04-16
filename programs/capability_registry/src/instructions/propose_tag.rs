use anchor_lang::prelude::*;

use crate::errors::CapabilityRegistryError;
use crate::events::TagApproved;
use crate::state::{
    validate_manifest_uri, validate_slug, CapabilityTag, RegistryConfig, MANIFEST_URI_LEN,
    MAX_TAGS, SLUG_LEN,
};

#[derive(Accounts)]
#[instruction(bit_index: u8)]
pub struct ProposeTag<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        has_one = authority @ CapabilityRegistryError::Unauthorized,
    )]
    pub config: Account<'info, RegistryConfig>,

    #[account(
        init,
        payer = payer,
        space = 8 + CapabilityTag::INIT_SPACE,
        seeds = [b"tag".as_ref(), &[bit_index]],
        bump,
    )]
    pub tag: Account<'info, CapabilityTag>,

    pub authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn propose_tag_handler(
    ctx: Context<ProposeTag>,
    bit_index: u8,
    slug: [u8; SLUG_LEN],
    manifest_uri: [u8; MANIFEST_URI_LEN],
) -> Result<()> {
    require!(bit_index < MAX_TAGS, CapabilityRegistryError::BitIndexOutOfRange);

    let config = &mut ctx.accounts.config;
    require!(!config.paused, CapabilityRegistryError::Paused);

    validate_slug(&slug)?;
    validate_manifest_uri(&manifest_uri)?;

    let tag = &mut ctx.accounts.tag;
    tag.bit_index = bit_index;
    tag.slug = slug;
    tag.manifest_uri = manifest_uri;
    tag.added_at = Clock::get()?.unix_timestamp;
    tag.added_by = ctx.accounts.authority.key();
    tag.retired = false;
    tag.min_personhood_tier = crate::state::PERSONHOOD_TIER_NONE;
    tag.bump = ctx.bumps.tag;

    config.set_bit(bit_index)?;
    config.tag_count = config
        .tag_count
        .checked_add(1)
        .ok_or(CapabilityRegistryError::TagCountOverflow)?;

    emit!(TagApproved {
        bit_index,
        slug,
        added_by: tag.added_by,
        timestamp: tag.added_at,
    });
    Ok(())
}
