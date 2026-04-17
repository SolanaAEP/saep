use anchor_lang::prelude::*;

use crate::errors::ProofVerifierError;
use crate::guard::{
    assert_reset_timelock, reset_guard, AllowedCallers, ReentrancyGuard, MAX_ALLOWED_CALLERS,
    SEED_ALLOWED_CALLERS, SEED_GUARD,
};
use crate::state::VerifierConfig;

#[derive(Accounts)]
pub struct InitGuard<'info> {
    #[account(
        seeds = [b"verifier_config"],
        bump = config.bump,
        has_one = authority @ ProofVerifierError::Unauthorized,
    )]
    pub config: Account<'info, VerifierConfig>,

    #[account(
        init,
        payer = authority,
        space = 8 + ReentrancyGuard::INIT_SPACE,
        seeds = [SEED_GUARD],
        bump,
    )]
    pub guard: Account<'info, ReentrancyGuard>,

    #[account(
        init,
        payer = authority,
        space = 8 + AllowedCallers::INIT_SPACE,
        seeds = [SEED_ALLOWED_CALLERS],
        bump,
    )]
    pub allowed_callers: Account<'info, AllowedCallers>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn init_guard_handler(ctx: Context<InitGuard>, initial_callers: Vec<Pubkey>) -> Result<()> {
    require!(
        initial_callers.len() <= MAX_ALLOWED_CALLERS,
        ProofVerifierError::UnauthorizedCaller
    );
    for p in &initial_callers {
        require!(*p != Pubkey::default(), ProofVerifierError::UnauthorizedCaller);
    }
    let g = &mut ctx.accounts.guard;
    reset_guard(g);
    g.bump = ctx.bumps.guard;

    let a = &mut ctx.accounts.allowed_callers;
    a.programs = initial_callers;
    a.bump = ctx.bumps.allowed_callers;
    Ok(())
}

#[derive(Accounts)]
pub struct SetAllowedCallers<'info> {
    #[account(
        seeds = [b"verifier_config"],
        bump = config.bump,
        has_one = authority @ ProofVerifierError::Unauthorized,
    )]
    pub config: Account<'info, VerifierConfig>,

    #[account(mut, seeds = [SEED_ALLOWED_CALLERS], bump = allowed_callers.bump)]
    pub allowed_callers: Account<'info, AllowedCallers>,

    pub authority: Signer<'info>,
}

pub fn set_allowed_callers_handler(
    ctx: Context<SetAllowedCallers>,
    programs: Vec<Pubkey>,
) -> Result<()> {
    require!(
        programs.len() <= MAX_ALLOWED_CALLERS,
        ProofVerifierError::UnauthorizedCaller
    );
    for p in &programs {
        require!(*p != Pubkey::default(), ProofVerifierError::UnauthorizedCaller);
    }
    ctx.accounts.allowed_callers.programs = programs;
    Ok(())
}

#[derive(Accounts)]
pub struct ProposeGuardReset<'info> {
    #[account(
        seeds = [b"verifier_config"],
        bump = config.bump,
        has_one = authority @ ProofVerifierError::Unauthorized,
    )]
    pub config: Account<'info, VerifierConfig>,

    #[account(mut, seeds = [SEED_GUARD], bump = guard.bump)]
    pub guard: Account<'info, ReentrancyGuard>,

    pub authority: Signer<'info>,
}

pub fn propose_guard_reset_handler(ctx: Context<ProposeGuardReset>) -> Result<()> {
    ctx.accounts.guard.reset_proposed_at = Clock::get()?.unix_timestamp;
    Ok(())
}

#[derive(Accounts)]
pub struct AdminResetGuard<'info> {
    #[account(
        seeds = [b"verifier_config"],
        bump = config.bump,
        has_one = authority @ ProofVerifierError::Unauthorized,
    )]
    pub config: Account<'info, VerifierConfig>,

    #[account(mut, seeds = [SEED_GUARD], bump = guard.bump)]
    pub guard: Account<'info, ReentrancyGuard>,

    pub authority: Signer<'info>,
}

pub fn admin_reset_guard_handler(ctx: Context<AdminResetGuard>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    assert_reset_timelock(&ctx.accounts.guard, now)?;
    reset_guard(&mut ctx.accounts.guard);
    Ok(())
}
