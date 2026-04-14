use anchor_lang::prelude::*;

use crate::events::RegistryInitialized;
use crate::state::RegistryConfig;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + RegistryConfig::INIT_SPACE,
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, RegistryConfig>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, authority: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.authority = authority;
    config.approved_mask = 0;
    config.tag_count = 0;
    config.pending_authority = None;
    config.paused = false;
    config.bump = ctx.bumps.config;

    emit!(RegistryInitialized { authority });
    Ok(())
}
