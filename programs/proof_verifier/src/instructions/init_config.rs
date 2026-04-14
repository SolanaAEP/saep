use anchor_lang::prelude::*;

use crate::events::VerifierInitialized;
use crate::state::{GlobalMode, VerifierConfig};

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + VerifierConfig::INIT_SPACE,
        seeds = [b"verifier_config"],
        bump,
    )]
    pub config: Account<'info, VerifierConfig>,

    #[account(
        init,
        payer = payer,
        space = 8 + GlobalMode::INIT_SPACE,
        seeds = [b"mode"],
        bump,
    )]
    pub mode: Account<'info, GlobalMode>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitConfig>, authority: Pubkey, is_mainnet: bool) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.authority = authority;
    config.pending_authority = None;
    config.active_vk = Pubkey::default();
    config.pending_vk = None;
    config.pending_activates_at = 0;
    config.paused = false;
    config.bump = ctx.bumps.config;

    let mode = &mut ctx.accounts.mode;
    mode.is_mainnet = is_mainnet;
    mode.bump = ctx.bumps.mode;

    emit!(VerifierInitialized { authority });
    Ok(())
}
