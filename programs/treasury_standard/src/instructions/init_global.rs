use anchor_lang::prelude::*;

use crate::events::TreasuryGlobalInitialized;
use crate::state::{AllowedMints, TreasuryGlobal, DEFAULT_MAX_STREAM_DURATION, MAX_ALLOWED_MINTS};

#[derive(Accounts)]
pub struct InitGlobal<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + TreasuryGlobal::INIT_SPACE,
        seeds = [b"treasury_global"],
        bump,
    )]
    pub global: Account<'info, TreasuryGlobal>,

    #[account(
        init,
        payer = payer,
        space = 8 + AllowedMints::INIT_SPACE,
        seeds = [b"allowed_mints"],
        bump,
    )]
    pub allowed_mints: Account<'info, AllowedMints>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitGlobal>,
    authority: Pubkey,
    agent_registry: Pubkey,
    jupiter_program: Pubkey,
    default_daily_limit: u64,
    max_daily_limit: u64,
) -> Result<()> {
    let g = &mut ctx.accounts.global;
    g.authority = authority;
    g.pending_authority = None;
    g.agent_registry = agent_registry;
    g.jupiter_program = jupiter_program;
    g.allowed_mints = ctx.accounts.allowed_mints.key();
    g.max_stream_duration = DEFAULT_MAX_STREAM_DURATION;
    g.default_daily_limit = default_daily_limit;
    g.max_daily_limit = max_daily_limit;
    g.paused = false;
    g.bump = ctx.bumps.global;
    g.global_call_targets = Vec::new();

    let a = &mut ctx.accounts.allowed_mints;
    a.authority = authority;
    a.mints = Vec::with_capacity(MAX_ALLOWED_MINTS);
    a.bump = ctx.bumps.allowed_mints;

    emit!(TreasuryGlobalInitialized {
        authority,
        agent_registry,
        jupiter_program,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
