use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
mod fuzz;
pub mod guard;

use errors::NxsStakingError;
use guard::{
    assert_reset_timelock, AllowedCallers, ReentrancyGuard, StakingConfig, MAX_ALLOWED_CALLERS,
    SEED_ALLOWED_CALLERS, SEED_GUARD, SEED_STAKING_CONFIG,
};

declare_id!("GjXfJ6MHb6SJ4XBK3qcpGw4n256qYPrDcXrNj6kf2i2Z");

#[program]
pub mod nxs_staking {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, authority: Pubkey) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.authority = authority;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn init_guard(ctx: Context<InitGuard>, initial_callers: Vec<Pubkey>) -> Result<()> {
        require!(
            initial_callers.len() <= MAX_ALLOWED_CALLERS,
            NxsStakingError::UnauthorizedCaller
        );
        for p in &initial_callers {
            require!(*p != Pubkey::default(), NxsStakingError::UnauthorizedCaller);
        }
        let g = &mut ctx.accounts.guard;
        g.active = false;
        g.entered_by = Pubkey::default();
        g.entered_at_slot = 0;
        g.reset_proposed_at = 0;
        g.bump = ctx.bumps.guard;

        let a = &mut ctx.accounts.allowed_callers;
        a.programs = initial_callers;
        a.bump = ctx.bumps.allowed_callers;
        Ok(())
    }

    pub fn set_allowed_callers(
        ctx: Context<SetAllowedCallers>,
        programs: Vec<Pubkey>,
    ) -> Result<()> {
        require!(
            programs.len() <= MAX_ALLOWED_CALLERS,
            NxsStakingError::UnauthorizedCaller
        );
        for p in &programs {
            require!(*p != Pubkey::default(), NxsStakingError::UnauthorizedCaller);
        }
        ctx.accounts.allowed_callers.programs = programs;
        Ok(())
    }

    pub fn propose_guard_reset(ctx: Context<ProposeGuardReset>) -> Result<()> {
        ctx.accounts.guard.reset_proposed_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn admin_reset_guard(ctx: Context<AdminResetGuard>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        assert_reset_timelock(&ctx.accounts.guard, now)?;
        let g = &mut ctx.accounts.guard;
        g.active = false;
        g.entered_by = Pubkey::default();
        g.entered_at_slot = 0;
        g.reset_proposed_at = 0;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + StakingConfig::INIT_SPACE,
        seeds = [SEED_STAKING_CONFIG],
        bump,
    )]
    pub config: Account<'info, StakingConfig>,

    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitGuard<'info> {
    #[account(
        seeds = [SEED_STAKING_CONFIG],
        bump = config.bump,
        has_one = authority @ NxsStakingError::Unauthorized,
    )]
    pub config: Account<'info, StakingConfig>,

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

#[derive(Accounts)]
pub struct SetAllowedCallers<'info> {
    #[account(
        seeds = [SEED_STAKING_CONFIG],
        bump = config.bump,
        has_one = authority @ NxsStakingError::Unauthorized,
    )]
    pub config: Account<'info, StakingConfig>,

    #[account(mut, seeds = [SEED_ALLOWED_CALLERS], bump = allowed_callers.bump)]
    pub allowed_callers: Account<'info, AllowedCallers>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ProposeGuardReset<'info> {
    #[account(
        seeds = [SEED_STAKING_CONFIG],
        bump = config.bump,
        has_one = authority @ NxsStakingError::Unauthorized,
    )]
    pub config: Account<'info, StakingConfig>,

    #[account(mut, seeds = [SEED_GUARD], bump = guard.bump)]
    pub guard: Account<'info, ReentrancyGuard>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdminResetGuard<'info> {
    #[account(
        seeds = [SEED_STAKING_CONFIG],
        bump = config.bump,
        has_one = authority @ NxsStakingError::Unauthorized,
    )]
    pub config: Account<'info, StakingConfig>,

    #[account(mut, seeds = [SEED_GUARD], bump = guard.bump)]
    pub guard: Account<'info, ReentrancyGuard>,

    pub authority: Signer<'info>,
}
