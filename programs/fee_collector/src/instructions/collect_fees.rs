use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::errors::FeeCollectorError;
use crate::events::{ConfidentialFeesCollected, FeesCollected};
use crate::state::*;

pub const MAX_COLLECT_SOURCES: usize = 10;

#[derive(Accounts)]
pub struct CollectFees<'info> {
    #[account(
        mut,
        seeds = [SEED_FEE_CONFIG],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, FeeCollectorConfig>>,

    #[account(
        mut,
        seeds = [SEED_EPOCH, config.next_epoch_id.saturating_sub(1).to_le_bytes().as_ref()],
        bump,
    )]
    pub current_epoch: Box<Account<'info, EpochAccount>>,

    #[account(mut, address = config.saep_mint)]
    pub saep_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = saep_mint,
        seeds = [SEED_INTAKE_VAULT],
        bump,
    )]
    pub intake_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: PDA used as withdraw-withheld authority on the mint's TransferFee config.
    #[account(
        seeds = [b"transfer_fee_withdraw_authority"],
        bump,
    )]
    pub fee_withdraw_authority: UncheckedAccount<'info>,

    pub cranker: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Harvest withheld TransferFee tokens from up to 10 holder accounts into the
/// mint, then withdraw from the mint into intake_vault. Permissionless crank.
pub fn harvest_transfer_fees<'a>(ctx: Context<'a, CollectFees<'a>>) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, FeeCollectorError::Paused);
    require!(
        ctx.accounts.current_epoch.status == EpochStatus::Open,
        FeeCollectorError::EpochNotOpen
    );

    let mint_key = ctx.accounts.saep_mint.key();
    let token_program_id = ctx.accounts.token_program.key();
    let remaining = ctx.remaining_accounts;
    require!(
        !remaining.is_empty() && remaining.len() <= MAX_COLLECT_SOURCES,
        FeeCollectorError::InvalidEpochStatus
    );

    let source_keys: Vec<Pubkey> = remaining.iter().map(|a| a.key()).collect();
    let source_refs: Vec<&Pubkey> = source_keys.iter().collect();

    let harvest_ix =
        spl_token_2022::extension::transfer_fee::instruction::harvest_withheld_tokens_to_mint(
            &token_program_id,
            &mint_key,
            &source_refs,
        )
        .map_err(|_| FeeCollectorError::ArithmeticOverflow)?;

    let mut harvest_accounts = vec![ctx.accounts.saep_mint.to_account_info()];
    harvest_accounts.extend(remaining.iter().cloned());
    invoke_signed(&harvest_ix, &harvest_accounts, &[])?;

    let fee_auth_key = ctx.accounts.fee_withdraw_authority.key();
    let fee_auth_bump = ctx.bumps.fee_withdraw_authority;

    let balance_before = ctx.accounts.intake_vault.amount;

    let withdraw_ix =
        spl_token_2022::extension::transfer_fee::instruction::withdraw_withheld_tokens_from_mint(
            &token_program_id,
            &mint_key,
            &ctx.accounts.intake_vault.key(),
            &fee_auth_key,
            &[],
        )
        .map_err(|_| FeeCollectorError::ArithmeticOverflow)?;

    let signer_seeds: &[&[u8]] = &[b"transfer_fee_withdraw_authority", &[fee_auth_bump]];
    invoke_signed(
        &withdraw_ix,
        &[
            ctx.accounts.saep_mint.to_account_info(),
            ctx.accounts.intake_vault.to_account_info(),
            ctx.accounts.fee_withdraw_authority.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        ],
        &[signer_seeds],
    )?;

    ctx.accounts.intake_vault.reload()?;
    let collected = ctx
        .accounts
        .intake_vault
        .amount
        .saturating_sub(balance_before);

    if collected > 0 {
        let epoch = &mut ctx.accounts.current_epoch;
        epoch.total_collected = epoch
            .total_collected
            .checked_add(collected)
            .ok_or(FeeCollectorError::ArithmeticOverflow)?;
    }

    let now = Clock::get()?.unix_timestamp;
    emit!(FeesCollected {
        epoch_id: ctx.accounts.current_epoch.epoch_id,
        amount: collected,
        collector: ctx.accounts.cranker.key(),
        timestamp: now,
    });
    Ok(())
}

/// Harvest withheld ConfidentialTransferFee tokens from holder accounts into
/// the mint. Permissionless crank — only the harvest step. Withdrawal from
/// mint requires off-chain proof generation because the fee authority must
/// produce a CiphertextCiphertextEquality proof to decrypt the accumulated
/// encrypted amount. That withdrawal is handled by the off-chain crank service.
pub fn harvest_confidential_fees<'a>(ctx: Context<'a, CollectFees<'a>>) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, FeeCollectorError::Paused);
    require!(
        config.confidential_transfers_enabled,
        FeeCollectorError::ConfidentialTransfersDisabled
    );
    require!(
        ctx.accounts.current_epoch.status == EpochStatus::Open,
        FeeCollectorError::EpochNotOpen
    );

    let mint_key = ctx.accounts.saep_mint.key();
    let token_program_id = ctx.accounts.token_program.key();
    let remaining = ctx.remaining_accounts;
    require!(
        !remaining.is_empty() && remaining.len() <= MAX_COLLECT_SOURCES,
        FeeCollectorError::InvalidEpochStatus
    );

    let source_keys: Vec<Pubkey> = remaining.iter().map(|a| a.key()).collect();
    let source_refs: Vec<&Pubkey> = source_keys.iter().collect();

    let harvest_ix = spl_token_2022::extension::confidential_transfer_fee::instruction::harvest_withheld_tokens_to_mint(
        &token_program_id,
        &mint_key,
        &source_refs,
    )
    .map_err(|_| FeeCollectorError::ArithmeticOverflow)?;

    let mut harvest_accounts = vec![ctx.accounts.saep_mint.to_account_info()];
    harvest_accounts.extend(remaining.iter().cloned());
    invoke_signed(&harvest_ix, &harvest_accounts, &[])?;

    let now = Clock::get()?.unix_timestamp;
    emit!(ConfidentialFeesCollected {
        epoch_id: ctx.accounts.current_epoch.epoch_id,
        amount: 0,
        collector: ctx.accounts.cranker.key(),
        timestamp: now,
    });
    Ok(())
}
