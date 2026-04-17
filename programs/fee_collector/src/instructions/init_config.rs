use anchor_lang::prelude::*;

use crate::errors::FeeCollectorError;
use crate::events::FeeCollectorInitialized;
use crate::state::*;

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(
        init,
        payer = deployer,
        space = 8 + FeeCollectorConfig::INIT_SPACE,
        seeds = [SEED_FEE_CONFIG],
        bump,
    )]
    pub config: Box<Account<'info, FeeCollectorConfig>>,

    #[account(
        init,
        payer = deployer,
        space = 8 + EpochAccount::INIT_SPACE,
        seeds = [SEED_EPOCH, 0u64.to_le_bytes().as_ref()],
        bump,
    )]
    pub epoch_zero: Box<Account<'info, EpochAccount>>,

    #[account(mut)]
    pub deployer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitConfigParams {
    pub authority: Pubkey,
    pub meta_authority: Pubkey,
    pub governance_program: Pubkey,
    pub nxs_staking: Pubkey,
    pub agent_registry: Pubkey,
    pub dispute_arbitration: Pubkey,
    pub emergency_council: Pubkey,
    pub saep_mint: Pubkey,
    pub grant_recipient: Pubkey,
    pub treasury_recipient: Pubkey,
    pub burn_bps: u16,
    pub staker_share_bps: u16,
    pub grant_share_bps: u16,
    pub treasury_share_bps: u16,
    pub epoch_duration_secs: i64,
    pub claim_window_secs: i64,
    pub min_epoch_total_for_burn: u64,
}

pub fn handler(ctx: Context<InitConfig>, params: InitConfigParams) -> Result<()> {
    let total_bps = params.burn_bps as u32
        + params.staker_share_bps as u32
        + params.grant_share_bps as u32
        + params.treasury_share_bps as u32;
    require!(total_bps == 10_000, FeeCollectorError::InvalidBpsSum);

    let now = Clock::get()?;

    let c = &mut ctx.accounts.config;
    c.authority = params.authority;
    c.pending_authority = None;
    c.meta_authority = params.meta_authority;
    c.governance_program = params.governance_program;
    c.nxs_staking = params.nxs_staking;
    c.agent_registry = params.agent_registry;
    c.dispute_arbitration = params.dispute_arbitration;
    c.emergency_council = params.emergency_council;
    c.saep_mint = params.saep_mint;
    c.grant_recipient = params.grant_recipient;
    c.treasury_recipient = params.treasury_recipient;
    c.burn_bps = params.burn_bps;
    c.staker_share_bps = params.staker_share_bps;
    c.grant_share_bps = params.grant_share_bps;
    c.treasury_share_bps = params.treasury_share_bps;
    c.burn_cap_bps = 2_000;
    c.staker_cap_bps = 7_500;
    c.grant_cap_bps = 3_000;
    c.treasury_cap_bps = 3_000;
    c.epoch_duration_secs = params.epoch_duration_secs;
    c.next_epoch_id = 1;
    c.claim_window_secs = params.claim_window_secs;
    c.min_epoch_total_for_burn = params.min_epoch_total_for_burn;
    c.paused = false;
    c.bump = ctx.bumps.config;

    let e = &mut ctx.accounts.epoch_zero;
    e.epoch_id = 0;
    e.status = EpochStatus::Open;
    e.started_at_slot = now.slot;
    e.started_at_ts = now.unix_timestamp;
    e.closed_at_slot = None;
    e.closed_at_ts = None;
    e.snapshot_id = 0;
    e.total_collected = 0;
    e.burn_amount = 0;
    e.burn_executed = false;
    e.staker_amount = 0;
    e.staker_distribution_root = [0u8; 32];
    e.staker_distribution_committed = false;
    e.staker_claimed_total = 0;
    e.grant_amount = 0;
    e.treasury_amount = 0;
    e.stale_swept = false;
    e.bump = ctx.bumps.epoch_zero;

    emit!(FeeCollectorInitialized {
        authority: c.authority,
        saep_mint: c.saep_mint,
        epoch_duration_secs: c.epoch_duration_secs,
        timestamp: now.unix_timestamp,
    });
    Ok(())
}
