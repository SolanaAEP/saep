use anchor_lang::prelude::*;

use crate::errors::CapabilityRegistryError;
use crate::events::TagManifestUpdated;
use crate::state::{validate_manifest_uri, CapabilityTag, RegistryConfig, MANIFEST_URI_LEN};

#[derive(Accounts)]
#[instruction(bit_index: u8)]
pub struct UpdateManifestUri<'info> {
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

pub fn handler(
    ctx: Context<UpdateManifestUri>,
    bit_index: u8,
    manifest_uri: [u8; MANIFEST_URI_LEN],
) -> Result<()> {
    require!(!ctx.accounts.config.paused, CapabilityRegistryError::Paused);

    let tag = &mut ctx.accounts.tag;
    require!(tag.bit_index == bit_index, CapabilityRegistryError::TagNotFound);
    require!(!tag.retired, CapabilityRegistryError::TagRetired);

    validate_manifest_uri(&manifest_uri)?;
    tag.manifest_uri = manifest_uri;

    emit!(TagManifestUpdated { bit_index });
    Ok(())
}
