use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::errors::FeeCollectorError;
use crate::events::EpochProcessed;
use crate::state::*;

#[derive(Accounts)]
pub struct ProcessEpoch<'info> {
    #[account(
        mut,
        seeds = [SEED_FEE_CONFIG],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, FeeCollectorConfig>>,

    #[account(
        mut,
        seeds = [SEED_EPOCH, current_epoch.epoch_id.to_le_bytes().as_ref()],
        bump = current_epoch.bump,
    )]
    pub current_epoch: Box<Account<'info, EpochAccount>>,

    #[account(
        init,
        payer = cranker,
        space = 8 + EpochAccount::INIT_SPACE,
        seeds = [SEED_EPOCH, config.next_epoch_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub next_epoch: Box<Account<'info, EpochAccount>>,

    #[account(address = config.saep_mint)]
    pub saep_mint: Box<InterfaceAccount<'info, Mint>>,

    /// intake vault token account — holds all accumulated fees
    #[account(
        mut,
        token::mint = saep_mint,
        seeds = [SEED_INTAKE_VAULT],
        bump,
    )]
    pub intake_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// burn vault token account
    #[account(
        mut,
        token::mint = saep_mint,
        seeds = [SEED_BURN_VAULT],
        bump,
    )]
    pub burn_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// staker vault token account
    #[account(
        mut,
        token::mint = saep_mint,
        seeds = [SEED_STAKER_VAULT],
        bump,
    )]
    pub staker_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// grant recipient token account
    #[account(mut, token::mint = saep_mint)]
    pub grant_recipient: Box<InterfaceAccount<'info, TokenAccount>>,

    /// treasury recipient token account
    #[account(mut, token::mint = saep_mint)]
    pub treasury_recipient: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub cranker: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ProcessEpoch>, snapshot_id: u64) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, FeeCollectorError::Paused);

    let epoch = &ctx.accounts.current_epoch;
    require!(
        epoch.status == EpochStatus::Open,
        FeeCollectorError::EpochNotOpen
    );

    let now = Clock::get()?;
    let epoch_end = epoch
        .started_at_ts
        .checked_add(config.epoch_duration_secs)
        .ok_or(FeeCollectorError::ArithmeticOverflow)?;
    require!(
        now.unix_timestamp >= epoch_end,
        FeeCollectorError::EpochNotElapsed
    );

    let total = epoch.total_collected;
    let (burn_amt, staker_amt, grant_amt, treasury_amt) = compute_bps_split(
        total,
        config.burn_bps,
        config.staker_share_bps,
        config.grant_share_bps,
        config.treasury_share_bps,
    );

    // state-before-CPI: update epoch
    let epoch = &mut ctx.accounts.current_epoch;
    epoch.status = EpochStatus::Splitting;
    epoch.closed_at_slot = Some(now.slot);
    epoch.closed_at_ts = Some(now.unix_timestamp);
    epoch.snapshot_id = snapshot_id;
    epoch.burn_amount = burn_amt;
    epoch.staker_amount = staker_amt;
    epoch.grant_amount = grant_amt;
    epoch.treasury_amount = treasury_amt;

    // find intake vault PDA bump for signing
    let (_, intake_bump) =
        Pubkey::find_program_address(&[SEED_INTAKE_VAULT], ctx.program_id);
    let intake_seeds: &[&[u8]] = &[SEED_INTAKE_VAULT, &[intake_bump]];
    let signer = &[intake_seeds];

    let decimals = ctx.accounts.saep_mint.decimals;

    // 4 fan-out transfers from intake_vault
    if burn_amt > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.intake_vault.to_account_info(),
                    mint: ctx.accounts.saep_mint.to_account_info(),
                    to: ctx.accounts.burn_vault.to_account_info(),
                    authority: ctx.accounts.intake_vault.to_account_info(),
                },
                signer,
            ),
            burn_amt,
            decimals,
        )?;
    }

    if staker_amt > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.intake_vault.to_account_info(),
                    mint: ctx.accounts.saep_mint.to_account_info(),
                    to: ctx.accounts.staker_vault.to_account_info(),
                    authority: ctx.accounts.intake_vault.to_account_info(),
                },
                signer,
            ),
            staker_amt,
            decimals,
        )?;
    }

    if grant_amt > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.intake_vault.to_account_info(),
                    mint: ctx.accounts.saep_mint.to_account_info(),
                    to: ctx.accounts.grant_recipient.to_account_info(),
                    authority: ctx.accounts.intake_vault.to_account_info(),
                },
                signer,
            ),
            grant_amt,
            decimals,
        )?;
    }

    if treasury_amt > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.intake_vault.to_account_info(),
                    mint: ctx.accounts.saep_mint.to_account_info(),
                    to: ctx.accounts.treasury_recipient.to_account_info(),
                    authority: ctx.accounts.intake_vault.to_account_info(),
                },
                signer,
            ),
            treasury_amt,
            decimals,
        )?;
    }

    // initialize next epoch
    let next = &mut ctx.accounts.next_epoch;
    next.epoch_id = ctx.accounts.config.next_epoch_id;
    next.status = EpochStatus::Open;
    next.started_at_slot = now.slot;
    next.started_at_ts = now.unix_timestamp;
    next.closed_at_slot = None;
    next.closed_at_ts = None;
    next.snapshot_id = 0;
    next.total_collected = 0;
    next.burn_amount = 0;
    next.burn_executed = false;
    next.staker_amount = 0;
    next.staker_distribution_root = [0u8; 32];
    next.staker_distribution_committed = false;
    next.staker_claimed_total = 0;
    next.grant_amount = 0;
    next.treasury_amount = 0;
    next.stale_swept = false;
    next.bump = ctx.bumps.next_epoch;

    ctx.accounts.config.next_epoch_id = ctx
        .accounts
        .config
        .next_epoch_id
        .checked_add(1)
        .ok_or(FeeCollectorError::ArithmeticOverflow)?;

    emit!(EpochProcessed {
        epoch_id: epoch.epoch_id,
        total_collected: total,
        burn_amount: burn_amt,
        staker_amount: staker_amt,
        grant_amount: grant_amt,
        treasury_amount: treasury_amt,
        snapshot_id,
        timestamp: now.unix_timestamp,
    });
    Ok(())
}
