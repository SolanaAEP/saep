use anchor_lang::prelude::*;

use crate::errors::DisputeArbitrationError;
use crate::guard::{assert_reset_timelock, reset_guard};
use crate::state::*;

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

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitConfigParams {
    pub authority: Pubkey,
    pub task_market: Pubkey,
    pub nxs_staking: Pubkey,
    pub fee_collector: Pubkey,
    pub agent_registry: Pubkey,
    pub switchboard_program: Pubkey,
    pub emergency_council: Pubkey,
    pub min_stake: u64,
    pub min_lock_secs: i64,
}

pub fn initialize_handler(ctx: Context<Initialize>, params: InitConfigParams) -> Result<()> {
    let c = &mut ctx.accounts.config;
    c.authority = params.authority;
    c.pending_authority = Pubkey::default();
    c.task_market = params.task_market;
    c.nxs_staking = params.nxs_staking;
    c.fee_collector = params.fee_collector;
    c.agent_registry = params.agent_registry;
    c.switchboard_program = params.switchboard_program;
    c.emergency_council = params.emergency_council;
    c.round1_size = MAX_ROUND1_ARBITRATORS as u8;
    c.round2_size = MAX_ROUND2_ARBITRATORS as u8;
    c.commit_window_secs = DEFAULT_COMMIT_WINDOW_SECS;
    c.reveal_window_secs = DEFAULT_REVEAL_WINDOW_SECS;
    c.appeal_window_secs = DEFAULT_APPEAL_WINDOW_SECS;
    c.appeal_collateral_bps = DEFAULT_APPEAL_COLLATERAL_BPS;
    c.max_slash_bps = DEFAULT_MAX_SLASH_BPS;
    c.slash_timelock_secs = DEFAULT_SLASH_TIMELOCK_SECS;
    c.min_stake = params.min_stake;
    c.min_lock_secs = params.min_lock_secs;
    c.vrf_stale_slots = DEFAULT_VRF_STALE_SLOTS;
    c.round2_window_secs = 7 * 24 * 60 * 60;
    c.bad_faith_threshold = DEFAULT_BAD_FAITH_THRESHOLD;
    c.bad_faith_lookback = DEFAULT_BAD_FAITH_LOOKBACK;
    c.next_case_id = 0;
    c.paused = false;
    c.bump = ctx.bumps.config;
    Ok(())
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

pub fn init_guard_handler(ctx: Context<InitGuard>, initial_callers: Vec<Pubkey>) -> Result<()> {
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
        seeds = [SEED_DISPUTE_CONFIG],
        bump = config.bump,
        has_one = authority @ DisputeArbitrationError::Unauthorized,
    )]
    pub config: Account<'info, DisputeConfig>,

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

pub fn propose_guard_reset_handler(ctx: Context<ProposeGuardReset>) -> Result<()> {
    ctx.accounts.guard.reset_proposed_at = Clock::get()?.unix_timestamp;
    Ok(())
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

pub fn admin_reset_guard_handler(ctx: Context<AdminResetGuard>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    assert_reset_timelock(&ctx.accounts.guard, now)?;
    reset_guard(&mut ctx.accounts.guard);
    Ok(())
}
