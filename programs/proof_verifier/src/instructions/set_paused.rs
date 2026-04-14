use anchor_lang::prelude::*;

use crate::errors::ProofVerifierError;
use crate::events::PausedSet;
use crate::state::VerifierConfig;

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(
        mut,
        seeds = [b"verifier_config"],
        bump = config.bump,
        has_one = authority @ ProofVerifierError::Unauthorized,
    )]
    pub config: Account<'info, VerifierConfig>,

    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.paused = paused;
    emit!(PausedSet { paused });
    Ok(())
}
