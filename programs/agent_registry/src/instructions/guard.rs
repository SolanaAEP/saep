use anchor_lang::prelude::*;

use crate::errors::AgentRegistryError;
use crate::events::{
    AllowedCallersUpdated, GuardAdminReset, GuardInitialized,
};
use crate::guard::{
    assert_reset_timelock, AllowedCallers, ReentrancyGuard, MAX_ALLOWED_CALLERS, SEED_ALLOWED_CALLERS,
    SEED_GUARD,
};
use crate::state::RegistryGlobal;

#[derive(Accounts)]
pub struct InitGuard<'info> {
    #[account(
        seeds = [b"global"],
        bump = global.bump,
        has_one = authority @ AgentRegistryError::Unauthorized,
    )]
    pub global: Account<'info, RegistryGlobal>,

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
        AgentRegistryError::UnauthorizedCaller
    );
    let g = &mut ctx.accounts.guard;
    g.active = false;
    g.entered_by = Pubkey::default();
    g.entered_at_slot = 0;
    g.reset_proposed_at = 0;
    g.bump = ctx.bumps.guard;

    let a = &mut ctx.accounts.allowed_callers;
    for p in &initial_callers {
        require!(*p != Pubkey::default(), AgentRegistryError::UnauthorizedCaller);
    }
    a.programs = initial_callers;
    a.bump = ctx.bumps.allowed_callers;

    let now = Clock::get()?.unix_timestamp;
    emit!(GuardInitialized {
        program: crate::ID,
        timestamp: now,
    });
    emit!(AllowedCallersUpdated {
        program: crate::ID,
        count: a.programs.len() as u16,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetAllowedCallers<'info> {
    #[account(
        seeds = [b"global"],
        bump = global.bump,
        has_one = authority @ AgentRegistryError::Unauthorized,
    )]
    pub global: Account<'info, RegistryGlobal>,

    #[account(
        mut,
        seeds = [SEED_ALLOWED_CALLERS],
        bump = allowed_callers.bump,
    )]
    pub allowed_callers: Account<'info, AllowedCallers>,

    pub authority: Signer<'info>,
}

pub fn set_allowed_callers_handler(
    ctx: Context<SetAllowedCallers>,
    programs: Vec<Pubkey>,
) -> Result<()> {
    require!(
        programs.len() <= MAX_ALLOWED_CALLERS,
        AgentRegistryError::UnauthorizedCaller
    );
    for p in &programs {
        require!(*p != Pubkey::default(), AgentRegistryError::UnauthorizedCaller);
    }
    let a = &mut ctx.accounts.allowed_callers;
    a.programs = programs;
    emit!(AllowedCallersUpdated {
        program: crate::ID,
        count: a.programs.len() as u16,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ProposeGuardReset<'info> {
    #[account(
        seeds = [b"global"],
        bump = global.bump,
        has_one = authority @ AgentRegistryError::Unauthorized,
    )]
    pub global: Account<'info, RegistryGlobal>,

    #[account(
        mut,
        seeds = [SEED_GUARD],
        bump = guard.bump,
    )]
    pub guard: Account<'info, ReentrancyGuard>,

    pub authority: Signer<'info>,
}

pub fn propose_guard_reset_handler(ctx: Context<ProposeGuardReset>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    ctx.accounts.guard.reset_proposed_at = now;
    Ok(())
}

#[derive(Accounts)]
pub struct AdminResetGuard<'info> {
    #[account(
        seeds = [b"global"],
        bump = global.bump,
        has_one = authority @ AgentRegistryError::Unauthorized,
    )]
    pub global: Account<'info, RegistryGlobal>,

    #[account(
        mut,
        seeds = [SEED_GUARD],
        bump = guard.bump,
    )]
    pub guard: Account<'info, ReentrancyGuard>,

    pub authority: Signer<'info>,
}

pub fn admin_reset_guard_handler(ctx: Context<AdminResetGuard>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let proposed_at = ctx.accounts.guard.reset_proposed_at;
    assert_reset_timelock(&ctx.accounts.guard, now)?;

    let g = &mut ctx.accounts.guard;
    g.active = false;
    g.entered_by = Pubkey::default();
    g.entered_at_slot = 0;
    g.reset_proposed_at = 0;

    emit!(GuardAdminReset {
        program: crate::ID,
        proposed_at,
        executed_at: now,
    });
    Ok(())
}
