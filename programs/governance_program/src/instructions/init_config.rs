use anchor_lang::prelude::*;

use crate::events::ConfigInitialized;
use crate::state::*;

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(
        init,
        payer = deployer,
        space = 8 + GovernanceConfig::INIT_SPACE,
        seeds = [SEED_GOV_CONFIG],
        bump,
    )]
    pub config: Box<Account<'info, GovernanceConfig>>,

    #[account(
        init,
        payer = deployer,
        space = 8 + ProgramRegistry::INIT_SPACE,
        seeds = [SEED_PROGRAM_REGISTRY],
        bump,
    )]
    pub registry: Box<Account<'info, ProgramRegistry>>,

    #[account(mut)]
    pub deployer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitConfigParams {
    pub authority: Pubkey,
    pub nxs_staking: Pubkey,
    pub capability_registry: Pubkey,
    pub fee_collector: Pubkey,
    pub emergency_council: Pubkey,
    pub min_proposer_stake: u64,
    pub proposer_collateral: u64,
    pub quorum_bps: u16,
    pub pass_threshold_bps: u16,
    pub meta_pass_threshold_bps: u16,
    pub dev_mode_timelock_override_secs: i64,
}

pub fn handler(ctx: Context<InitConfig>, params: InitConfigParams) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    let c = &mut ctx.accounts.config;
    c.authority = params.authority;
    c.nxs_staking = params.nxs_staking;
    c.capability_registry = params.capability_registry;
    c.fee_collector = params.fee_collector;
    c.emergency_council = params.emergency_council;
    c.min_proposer_stake = params.min_proposer_stake;
    c.proposer_collateral = params.proposer_collateral;
    c.vote_window_secs_standard = 5 * 86_400;
    c.vote_window_secs_emergency = 86_400;
    c.vote_window_secs_meta = 7 * 86_400;
    c.quorum_bps = params.quorum_bps;
    c.pass_threshold_bps = params.pass_threshold_bps;
    c.meta_pass_threshold_bps = params.meta_pass_threshold_bps;
    c.timelock_secs_standard = 7 * 86_400;
    c.timelock_secs_critical = 14 * 86_400;
    c.timelock_secs_meta = 21 * 86_400;
    c.min_lock_to_vote_secs = 30 * 86_400;
    c.dev_mode_timelock_override_secs = params.dev_mode_timelock_override_secs;
    c.next_proposal_id = 0;
    c.next_emergency_id = 0;
    c.paused = false;
    c.bump = ctx.bumps.config;

    let r = &mut ctx.accounts.registry;
    r.entries = Vec::new();
    r.bump = ctx.bumps.registry;

    emit!(ConfigInitialized {
        authority: c.authority,
        timestamp: now,
    });
    Ok(())
}
