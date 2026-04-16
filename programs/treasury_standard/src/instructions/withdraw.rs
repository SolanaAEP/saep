use anchor_lang::prelude::*;
use anchor_spl::token_2022::{transfer_checked, Token2022, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::errors::TreasuryError;
use crate::events::TreasuryWithdraw;
use crate::state::{
    apply_rollover, assert_call_target_allowed, guard_oracle, normalize_to_base_units,
    read_oracle, AgentTreasury, AllowedTargets, TreasuryGlobal,
};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(seeds = [b"treasury_global"], bump = global.bump)]
    pub global: Account<'info, TreasuryGlobal>,

    #[account(
        mut,
        seeds = [b"treasury", treasury.agent_did.as_ref()],
        bump = treasury.bump,
        has_one = operator @ TreasuryError::Unauthorized,
    )]
    pub treasury: Account<'info, AgentTreasury>,

    #[account(
        seeds = [b"allowed_targets", treasury.agent_did.as_ref()],
        bump = allowed_targets.bump,
    )]
    pub allowed_targets: Option<Account<'info, AllowedTargets>>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"vault", treasury.agent_did.as_ref(), mint.key().as_ref()],
        bump,
        token::mint = mint,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub destination: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Pyth PriceUpdateV2 for mint/USD — deserialized + validated via read_oracle.
    /// Required for non-USDC mints to normalize spend against 6-decimal limits.
    pub price_feed: Option<UncheckedAccount<'info>>,

    pub operator: Signer<'info>,
    pub token_program: Program<'info, Token2022>,
}

pub fn handler(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(!ctx.accounts.global.paused, TreasuryError::Paused);
    require!(amount > 0, TreasuryError::ZeroAmount);
    require!(
        ctx.accounts.vault.amount >= amount,
        TreasuryError::InsufficientVault
    );

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let t = &mut ctx.accounts.treasury;
    apply_rollover(t, now);

    let normalized = match &ctx.accounts.price_feed {
        Some(feed) => {
            let oracle = read_oracle(&feed.to_account_info(), &clock)?;
            guard_oracle(&oracle)?;
            normalize_to_base_units(amount, &oracle, ctx.accounts.mint.decimals)?
        }
        None => amount,
    };

    require!(normalized <= t.per_tx_limit, TreasuryError::LimitExceeded);
    let new_daily = t
        .spent_today
        .checked_add(normalized)
        .ok_or(TreasuryError::ArithmeticOverflow)?;
    require!(new_daily <= t.daily_spend_limit, TreasuryError::LimitExceeded);
    let new_weekly = t
        .spent_this_week
        .checked_add(normalized)
        .ok_or(TreasuryError::ArithmeticOverflow)?;
    require!(new_weekly <= t.weekly_limit, TreasuryError::LimitExceeded);

    t.spent_today = new_daily;
    t.spent_this_week = new_weekly;

    let agent_did = t.agent_did;
    let mint_key = ctx.accounts.mint.key();
    let vault_bump = ctx.bumps.vault;

    let seeds: &[&[u8]] = &[
        b"vault",
        agent_did.as_ref(),
        mint_key.as_ref(),
        core::slice::from_ref(&vault_bump),
    ];
    let signer = &[seeds];

    let decimals = ctx.accounts.mint.decimals;
    let token_program_key = ctx.accounts.token_program.key();
    assert_call_target_allowed(
        &ctx.accounts.global,
        ctx.accounts.allowed_targets.as_deref(),
        &token_program_key,
    )?;
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.vault.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.destination.to_account_info(),
        authority: ctx.accounts.vault.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(token_program_key, cpi_accounts, signer);
    transfer_checked(cpi_ctx, amount, decimals)?;

    emit!(TreasuryWithdraw {
        agent_did,
        mint: mint_key,
        amount,
        normalized_amount: normalized,
        destination: ctx.accounts.destination.key(),
        timestamp: now,
    });
    Ok(())
}
