use anchor_lang::prelude::*;

use crate::errors::CapabilityRegistryError;
use crate::events::PausedSet;
use crate::state::RegistryConfig;

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        has_one = authority @ CapabilityRegistryError::Unauthorized,
    )]
    pub config: Account<'info, RegistryConfig>,

    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.paused = paused;
    emit!(PausedSet { paused });
    Ok(())
}
