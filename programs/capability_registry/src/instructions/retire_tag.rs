use anchor_lang::prelude::*;

use crate::errors::CapabilityRegistryError;
use crate::events::TagRetired;
use crate::state::{CapabilityTag, RegistryConfig};

#[derive(Accounts)]
#[instruction(bit_index: u8)]
pub struct RetireTag<'info> {
    #[account(
        mut,
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

pub fn handler(ctx: Context<RetireTag>, bit_index: u8) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(!config.paused, CapabilityRegistryError::Paused);

    let tag = &mut ctx.accounts.tag;
    require!(tag.bit_index == bit_index, CapabilityRegistryError::TagNotFound);
    require!(!tag.retired, CapabilityRegistryError::TagRetired);

    tag.retired = true;
    config.clear_bit(bit_index)?;

    emit!(TagRetired {
        bit_index,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
