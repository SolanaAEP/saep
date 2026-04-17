use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::errors::FeeCollectorError;
use crate::events::EpochSwept;
use crate::state::*;

#[derive(Accounts)]
#[instruction(epoch_id: u64)]
pub struct SweepStaleEpoch<'info> {
    #[account(seeds = [SEED_FEE_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, FeeCollectorConfig>>,

    #[account(
        mut,
        seeds = [SEED_EPOCH, epoch_id.to_le_bytes().as_ref()],
        bump = epoch.bump,
    )]
    pub epoch: Box<Account<'info, EpochAccount>>,

    /// next epoch to credit the residuals
    #[account(
        mut,
        seeds = [SEED_EPOCH, (epoch_id + 1).to_le_bytes().as_ref()],
        bump = next_epoch.bump,
    )]
    pub next_epoch: Box<Account<'info, EpochAccount>>,

    #[account(address = config.saep_mint)]
    pub saep_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = saep_mint,
        seeds = [SEED_STAKER_VAULT],
        bump,
    )]
    pub staker_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = saep_mint,
        seeds = [SEED_BURN_VAULT],
        bump,
    )]
    pub burn_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = saep_mint,
        seeds = [SEED_INTAKE_VAULT],
        bump,
    )]
    pub intake_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub cranker: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<SweepStaleEpoch>, epoch_id: u64) -> Result<()> {
    require!(epoch_id < u64::MAX, FeeCollectorError::ArithmeticOverflow);
    let epoch = &ctx.accounts.epoch;
    require!(
        matches!(
            epoch.status,
            EpochStatus::Splitting | EpochStatus::DistributionCommitted
        ),
        FeeCollectorError::InvalidEpochStatus
    );
    require!(!epoch.stale_swept, FeeCollectorError::AlreadySwept);

    let now = Clock::get()?.unix_timestamp;
    let closed_ts = epoch.closed_at_ts.unwrap_or(0);
    let sweep_deadline = closed_ts
        .checked_add(ctx.accounts.config.claim_window_secs)
        .ok_or(FeeCollectorError::ArithmeticOverflow)?
        .checked_add(SWEEP_GRACE_SECS)
        .ok_or(FeeCollectorError::ArithmeticOverflow)?;
    require!(
        now >= sweep_deadline,
        FeeCollectorError::SweepGraceNotElapsed
    );

    let residual_staker = epoch
        .staker_amount
        .saturating_sub(epoch.staker_claimed_total);
    let residual_burn = if epoch.burn_executed {
        0
    } else {
        epoch.burn_amount
    };
    let total_sweep = residual_staker
        .checked_add(residual_burn)
        .ok_or(FeeCollectorError::ArithmeticOverflow)?;

    // state-before-CPI
    let epoch = &mut ctx.accounts.epoch;
    epoch.status = EpochStatus::Stale;
    epoch.stale_swept = true;

    ctx.accounts.next_epoch.total_collected = ctx
        .accounts
        .next_epoch
        .total_collected
        .checked_add(total_sweep)
        .ok_or(FeeCollectorError::ArithmeticOverflow)?;

    let decimals = ctx.accounts.saep_mint.decimals;

    // sweep staker residual back to intake
    if residual_staker > 0 {
        let (_, vault_bump) =
            Pubkey::find_program_address(&[SEED_STAKER_VAULT], ctx.program_id);
        let seeds: &[&[u8]] = &[SEED_STAKER_VAULT, &[vault_bump]];
        let signer = &[seeds];

        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.staker_vault.to_account_info(),
                    mint: ctx.accounts.saep_mint.to_account_info(),
                    to: ctx.accounts.intake_vault.to_account_info(),
                    authority: ctx.accounts.staker_vault.to_account_info(),
                },
                signer,
            ),
            residual_staker,
            decimals,
        )?;
    }

    // sweep unburned amount back to intake
    if residual_burn > 0 {
        let (_, vault_bump) =
            Pubkey::find_program_address(&[SEED_BURN_VAULT], ctx.program_id);
        let seeds: &[&[u8]] = &[SEED_BURN_VAULT, &[vault_bump]];
        let signer = &[seeds];

        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.burn_vault.to_account_info(),
                    mint: ctx.accounts.saep_mint.to_account_info(),
                    to: ctx.accounts.intake_vault.to_account_info(),
                    authority: ctx.accounts.burn_vault.to_account_info(),
                },
                signer,
            ),
            residual_burn,
            decimals,
        )?;
    }

    emit!(EpochSwept {
        epoch_id,
        residual_staker,
        residual_burn,
        rolled_to_epoch: epoch_id + 1,
        timestamp: now,
    });
    Ok(())
}
