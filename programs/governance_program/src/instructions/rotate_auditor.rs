use anchor_lang::prelude::*;

use crate::errors::GovernanceError;
use crate::events::AuditorKeyRotated;
use crate::state::{GovernanceConfig, SEED_GOV_CONFIG};

#[derive(Accounts)]
pub struct RotateAuditorKey<'info> {
    #[account(
        mut,
        seeds = [SEED_GOV_CONFIG],
        bump = config.bump,
    )]
    pub config: Account<'info, GovernanceConfig>,

    pub signer: Signer<'info>,
}

pub fn handler(ctx: Context<RotateAuditorKey>, new_elgamal_key: [u8; 32]) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let signer = ctx.accounts.signer.key();

    require!(
        signer == config.authority || signer == config.emergency_council,
        GovernanceError::Unauthorized
    );

    let old_key = config.auditor_elgamal_key;
    config.auditor_elgamal_key = new_elgamal_key;

    emit!(AuditorKeyRotated {
        old_key,
        new_key: new_elgamal_key,
        rotated_by: signer,
        slot: Clock::get()?.slot,
    });

    Ok(())
}
