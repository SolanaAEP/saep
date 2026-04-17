use anchor_lang::prelude::*;

use crate::errors::ProofVerifierError;
use crate::events::VkRegistered;
use crate::state::{VerifierConfig, VerifierKey};

#[derive(Accounts)]
pub struct AppendVkIc<'info> {
    #[account(
        seeds = [b"verifier_config"],
        bump = config.bump,
        has_one = authority @ ProofVerifierError::Unauthorized,
    )]
    pub config: Account<'info, VerifierConfig>,

    #[account(
        mut,
        seeds = [b"vk", vk.vk_id.as_ref()],
        bump = vk.bump,
        constraint = vk.registered_at == 0 @ ProofVerifierError::VkAlreadyFinalized,
        constraint = vk.registered_by == authority.key() @ ProofVerifierError::Unauthorized,
    )]
    pub vk: Account<'info, VerifierKey>,

    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<AppendVkIc>, ic_points: Vec<[u8; 64]>, finalize: bool) -> Result<()> {
    require!(!ctx.accounts.config.paused, ProofVerifierError::Paused);

    let vk = &mut ctx.accounts.vk;
    let expected_total = (vk.num_public_inputs as usize) + 1;

    for point in &ic_points {
        require!(
            vk.ic.len() < expected_total,
            ProofVerifierError::IcLengthMismatch
        );
        vk.ic.push(*point);
    }

    if finalize {
        require!(
            vk.ic.len() == expected_total,
            ProofVerifierError::IcLengthMismatch
        );
        vk.registered_at = Clock::get()?.unix_timestamp;

        emit!(VkRegistered {
            vk_id: vk.vk_id,
            circuit_label: vk.circuit_label,
            is_production: vk.is_production,
        });
    }

    Ok(())
}
