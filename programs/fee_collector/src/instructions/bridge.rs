use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    mint_to, burn, transfer_checked,
    Mint, MintTo, Burn, TokenAccount, TokenInterface, TransferChecked,
};

use crate::errors::FeeCollectorError;
use crate::events::{SaepDeposited, SaepWithdrawn};
use crate::state::*;

#[derive(Accounts)]
pub struct DepositSaep<'info> {
    #[account(
        seeds = [SEED_FEE_CONFIG],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, FeeCollectorConfig>>,

    #[account(mut, address = config.external_saep_mint)]
    pub external_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = config.saep_mint)]
    pub internal_mint: Box<InterfaceAccount<'info, Mint>>,

    /// SPL $SAEP token account of the depositor.
    #[account(
        mut,
        token::mint = external_mint,
        token::authority = depositor,
    )]
    pub depositor_external: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Internal T22 token account of the depositor.
    #[account(
        mut,
        token::mint = internal_mint,
    )]
    pub depositor_internal: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Protocol vault holding SPL $SAEP backing.
    #[account(
        mut,
        token::mint = external_mint,
        seeds = [SEED_DEPOSIT_VAULT],
        bump,
    )]
    pub deposit_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: PDA used as mint authority for the internal T22 mint.
    #[account(
        seeds = [SEED_MINT_AUTHORITY],
        bump,
    )]
    pub mint_authority: UncheckedAccount<'info>,

    pub depositor: Signer<'info>,
    pub external_token_program: Interface<'info, TokenInterface>,
    pub internal_token_program: Interface<'info, TokenInterface>,
}

/// Deposit SPL $SAEP into the protocol. Transfers external tokens to the
/// deposit vault and mints 1:1 internal T22 tokens to the depositor.
pub fn deposit_handler(ctx: Context<DepositSaep>, amount: u64) -> Result<()> {
    require!(amount > 0, FeeCollectorError::ZeroDeposit);
    require!(!ctx.accounts.config.paused, FeeCollectorError::Paused);

    let decimals = ctx.accounts.external_mint.decimals;

    // Transfer SPL $SAEP from depositor → deposit vault
    transfer_checked(
        CpiContext::new(
            ctx.accounts.external_token_program.key(),
            TransferChecked {
                from: ctx.accounts.depositor_external.to_account_info(),
                mint: ctx.accounts.external_mint.to_account_info(),
                to: ctx.accounts.deposit_vault.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        ),
        amount,
        decimals,
    )?;

    // Mint 1:1 internal T22 tokens to depositor
    let mint_auth_bump = ctx.bumps.mint_authority;
    let signer_seeds: &[&[u8]] = &[SEED_MINT_AUTHORITY, &[mint_auth_bump]];
    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.internal_token_program.key(),
            MintTo {
                mint: ctx.accounts.internal_mint.to_account_info(),
                to: ctx.accounts.depositor_internal.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
            &[signer_seeds],
        ),
        amount,
    )?;

    let now = Clock::get()?.unix_timestamp;
    emit!(SaepDeposited {
        depositor: ctx.accounts.depositor.key(),
        amount,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawSaep<'info> {
    #[account(
        seeds = [SEED_FEE_CONFIG],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, FeeCollectorConfig>>,

    #[account(mut, address = config.external_saep_mint)]
    pub external_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = config.saep_mint)]
    pub internal_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Internal T22 token account of the withdrawer (tokens get burned).
    #[account(
        mut,
        token::mint = internal_mint,
        token::authority = withdrawer,
    )]
    pub withdrawer_internal: Box<InterfaceAccount<'info, TokenAccount>>,

    /// SPL $SAEP destination for the withdrawer.
    #[account(
        mut,
        token::mint = external_mint,
    )]
    pub withdrawer_external: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Protocol vault holding SPL $SAEP backing.
    #[account(
        mut,
        token::mint = external_mint,
        seeds = [SEED_DEPOSIT_VAULT],
        bump,
    )]
    pub deposit_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: PDA used as mint authority for the internal T22 mint.
    #[account(
        seeds = [SEED_MINT_AUTHORITY],
        bump,
    )]
    pub mint_authority: UncheckedAccount<'info>,

    pub withdrawer: Signer<'info>,
    pub external_token_program: Interface<'info, TokenInterface>,
    pub internal_token_program: Interface<'info, TokenInterface>,
}

/// Withdraw SPL $SAEP from the protocol. Burns internal T22 tokens and
/// returns 1:1 SPL $SAEP from the deposit vault.
pub fn withdraw_handler(ctx: Context<WithdrawSaep>, amount: u64) -> Result<()> {
    require!(amount > 0, FeeCollectorError::ZeroDeposit);
    require!(!ctx.accounts.config.paused, FeeCollectorError::Paused);
    require!(
        ctx.accounts.withdrawer_internal.amount >= amount,
        FeeCollectorError::InsufficientBalance
    );

    let decimals = ctx.accounts.external_mint.decimals;

    // Burn internal T22 tokens from withdrawer
    burn(
        CpiContext::new(
            ctx.accounts.internal_token_program.key(),
            Burn {
                mint: ctx.accounts.internal_mint.to_account_info(),
                from: ctx.accounts.withdrawer_internal.to_account_info(),
                authority: ctx.accounts.withdrawer.to_account_info(),
            },
        ),
        amount,
    )?;

    // Transfer SPL $SAEP from deposit vault → withdrawer
    let vault_bump = ctx.bumps.deposit_vault;
    let vault_seeds: &[&[u8]] = &[SEED_DEPOSIT_VAULT, &[vault_bump]];
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.external_token_program.key(),
            TransferChecked {
                from: ctx.accounts.deposit_vault.to_account_info(),
                mint: ctx.accounts.external_mint.to_account_info(),
                to: ctx.accounts.withdrawer_external.to_account_info(),
                authority: ctx.accounts.deposit_vault.to_account_info(),
            },
            &[vault_seeds],
        ),
        amount,
        decimals,
    )?;

    let now = Clock::get()?.unix_timestamp;
    emit!(SaepWithdrawn {
        withdrawer: ctx.accounts.withdrawer.key(),
        amount,
        timestamp: now,
    });
    Ok(())
}
