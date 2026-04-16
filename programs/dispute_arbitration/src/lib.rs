use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod guard;

use errors::DisputeArbitrationError;
use guard::{
    assert_reset_timelock, AllowedCallers, DisputeConfig, ReentrancyGuard, MAX_ALLOWED_CALLERS,
    SEED_ALLOWED_CALLERS, SEED_DISPUTE_CONFIG, SEED_GUARD,
};

declare_id!("GM8xiT17USBpCW24XXBmUR8YVCxxrJPMEcsddwfUokMa");

#[program]
pub mod dispute_arbitration {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, authority: Pubkey) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.authority = authority;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn init_guard(
        ctx: Context<InitGuard>,
        initial_callers: Vec<Pubkey>,
    ) -> Result<()> {
        require!(
            initial_callers.len() <= MAX_ALLOWED_CALLERS,
            DisputeArbitrationError::UnauthorizedCaller
        );
        for p in &initial_callers {
            require!(
                *p != Pubkey::default(),
                DisputeArbitrationError::UnauthorizedCaller
            );
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
            DisputeArbitrationError::UnauthorizedCaller
        );
        for p in &programs {
            require!(
                *p != Pubkey::default(),
                DisputeArbitrationError::UnauthorizedCaller
            );
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
        space = 8 + DisputeConfig::INIT_SPACE,
        seeds = [SEED_DISPUTE_CONFIG],
        bump,
    )]
    pub config: Account<'info, DisputeConfig>,

    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitGuard<'info> {
    #[account(
        seeds = [SEED_DISPUTE_CONFIG],
        bump = config.bump,
        has_one = authority @ DisputeArbitrationError::Unauthorized,
    )]
    pub config: Account<'info, DisputeConfig>,

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
        seeds = [SEED_DISPUTE_CONFIG],
        bump = config.bump,
        has_one = authority @ DisputeArbitrationError::Unauthorized,
    )]
    pub config: Account<'info, DisputeConfig>,

    #[account(mut, seeds = [SEED_ALLOWED_CALLERS], bump = allowed_callers.bump)]
    pub allowed_callers: Account<'info, AllowedCallers>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ProposeGuardReset<'info> {
    #[account(
        seeds = [SEED_DISPUTE_CONFIG],
        bump = config.bump,
        has_one = authority @ DisputeArbitrationError::Unauthorized,
    )]
    pub config: Account<'info, DisputeConfig>,

    #[account(mut, seeds = [SEED_GUARD], bump = guard.bump)]
    pub guard: Account<'info, ReentrancyGuard>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdminResetGuard<'info> {
    #[account(
        seeds = [SEED_DISPUTE_CONFIG],
        bump = config.bump,
        has_one = authority @ DisputeArbitrationError::Unauthorized,
    )]
    pub config: Account<'info, DisputeConfig>,

    #[account(mut, seeds = [SEED_GUARD], bump = guard.bump)]
    pub guard: Account<'info, ReentrancyGuard>,

    pub authority: Signer<'info>,
}
