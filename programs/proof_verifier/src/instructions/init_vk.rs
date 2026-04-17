use anchor_lang::prelude::*;

use crate::errors::ProofVerifierError;
use crate::state::{VerifierConfig, VerifierKey, MAX_PUBLIC_INPUTS};

#[derive(Accounts)]
#[instruction(vk_id: [u8; 32])]
pub struct InitVk<'info> {
    #[account(
        seeds = [b"verifier_config"],
        bump = config.bump,
        has_one = authority @ ProofVerifierError::Unauthorized,
    )]
    pub config: Account<'info, VerifierConfig>,

    #[account(
        init,
        payer = payer,
        space = 8 + VerifierKey::INIT_SPACE,
        seeds = [b"vk", vk_id.as_ref()],
        bump,
    )]
    pub vk: Account<'info, VerifierKey>,

    pub authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitVk>,
    vk_id: [u8; 32],
    alpha_g1: [u8; 64],
    beta_g2: [u8; 128],
    gamma_g2: [u8; 128],
    delta_g2: [u8; 128],
    num_public_inputs: u8,
    circuit_label: [u8; 32],
    is_production: bool,
) -> Result<()> {
    require!(!ctx.accounts.config.paused, ProofVerifierError::Paused);
    require!(
        num_public_inputs <= MAX_PUBLIC_INPUTS,
        ProofVerifierError::TooManyPublicInputs
    );

    let vk = &mut ctx.accounts.vk;
    vk.vk_id = vk_id;
    vk.alpha_g1 = alpha_g1;
    vk.beta_g2 = beta_g2;
    vk.gamma_g2 = gamma_g2;
    vk.delta_g2 = delta_g2;
    vk.ic = Vec::new();
    vk.num_public_inputs = num_public_inputs;
    vk.circuit_label = circuit_label;
    vk.is_production = is_production;
    vk.registered_at = 0; // set on finalization
    vk.registered_by = ctx.accounts.authority.key();
    vk.bump = ctx.bumps.vk;

    Ok(())
}
