use anchor_lang::prelude::*;

use crate::errors::ProofVerifierError;
use crate::events::{VkActivated, VkActivationCancelled, VkActivationProposed};
use crate::state::{GlobalMode, VerifierConfig, VerifierKey, VK_ROTATION_TIMELOCK_SECS};

#[derive(Accounts)]
pub struct ProposeVkActivation<'info> {
    #[account(
        mut,
        seeds = [b"verifier_config"],
        bump = config.bump,
        has_one = authority @ ProofVerifierError::Unauthorized,
    )]
    pub config: Account<'info, VerifierConfig>,

    #[account(
        seeds = [b"vk", vk.vk_id.as_ref()],
        bump = vk.bump,
    )]
    pub vk: Account<'info, VerifierKey>,

    #[account(seeds = [b"mode"], bump = mode.bump)]
    pub mode: Account<'info, GlobalMode>,

    pub authority: Signer<'info>,
}

pub fn propose_handler(ctx: Context<ProposeVkActivation>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(config.pending_vk.is_none(), ProofVerifierError::ActivationPending);

    if ctx.accounts.mode.is_mainnet {
        require!(
            ctx.accounts.vk.is_production,
            ProofVerifierError::NotProductionVk
        );
    }

    let now = Clock::get()?.unix_timestamp;
    let activates_at = now.saturating_add(VK_ROTATION_TIMELOCK_SECS);
    config.pending_vk = Some(ctx.accounts.vk.key());
    config.pending_activates_at = activates_at;

    emit!(VkActivationProposed {
        vk_id: ctx.accounts.vk.vk_id,
        activates_at,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteVkActivation<'info> {
    #[account(
        mut,
        seeds = [b"verifier_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, VerifierConfig>,

    #[account(
        seeds = [b"vk", vk.vk_id.as_ref()],
        bump = vk.bump,
    )]
    pub vk: Account<'info, VerifierKey>,
}

pub fn execute_handler(ctx: Context<ExecuteVkActivation>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let pending = config
        .pending_vk
        .ok_or(ProofVerifierError::NoPendingActivation)?;
    require_keys_eq!(
        pending,
        ctx.accounts.vk.key(),
        ProofVerifierError::VkMismatch
    );

    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= config.pending_activates_at,
        ProofVerifierError::TimelockNotElapsed
    );

    config.active_vk = pending;
    config.pending_vk = None;
    config.pending_activates_at = 0;

    emit!(VkActivated {
        vk_id: ctx.accounts.vk.vk_id,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CancelVkActivation<'info> {
    #[account(
        mut,
        seeds = [b"verifier_config"],
        bump = config.bump,
        has_one = authority @ ProofVerifierError::Unauthorized,
    )]
    pub config: Account<'info, VerifierConfig>,

    pub authority: Signer<'info>,
}

pub fn cancel_handler(ctx: Context<CancelVkActivation>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let pending = config
        .pending_vk
        .ok_or(ProofVerifierError::NoPendingActivation)?;
    let vk_id = pending.to_bytes();
    config.pending_vk = None;
    config.pending_activates_at = 0;
    emit!(VkActivationCancelled { vk_id });
    Ok(())
}
