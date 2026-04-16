use anchor_lang::prelude::*;
use anchor_spl::token_2022::{transfer_checked, Token2022, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount};

use fee_collector::{assert_hook_allowed_at_site, HookAllowlist, SITE_FUND_TREASURY};

use crate::errors::TreasuryError;
use crate::events::TreasuryFunded;
use crate::state::{
    assert_call_target_allowed, resolve_hook_allowlist, AgentTreasury, AllowedMints,
    AllowedTargets, TreasuryGlobal,
};

#[derive(Accounts)]
pub struct FundTreasury<'info> {
    #[account(seeds = [b"treasury_global"], bump = global.bump)]
    pub global: Box<Account<'info, TreasuryGlobal>>,

    #[account(
        seeds = [b"allowed_mints"],
        bump = allowed_mints.bump,
        address = global.allowed_mints,
    )]
    pub allowed_mints: Box<Account<'info, AllowedMints>>,

    #[account(
        seeds = [b"treasury", treasury.agent_did.as_ref()],
        bump = treasury.bump,
    )]
    pub treasury: Box<Account<'info, AgentTreasury>>,

    #[account(
        seeds = [b"allowed_targets", treasury.agent_did.as_ref()],
        bump = allowed_targets.bump,
    )]
    pub allowed_targets: Option<Account<'info, AllowedTargets>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init_if_needed,
        payer = funder,
        token::mint = mint,
        token::authority = vault,
        token::token_program = token_program,
        seeds = [b"vault", treasury.agent_did.as_ref(), mint.key().as_ref()],
        bump,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = mint, token::authority = funder, token::token_program = token_program)]
    pub funder_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub hook_allowlist: Option<Account<'info, HookAllowlist>>,

    #[account(mut)]
    pub funder: Signer<'info>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<FundTreasury>, amount: u64) -> Result<()> {
    require!(!ctx.accounts.global.paused, TreasuryError::Paused);
    require!(amount > 0, TreasuryError::ZeroAmount);

    let mint_key = ctx.accounts.mint.key();
    require!(
        ctx.accounts.allowed_mints.mints.iter().any(|m| m == &mint_key),
        TreasuryError::MintNotAllowed
    );

    let decimals = ctx.accounts.mint.decimals;
    let token_program_key = ctx.accounts.token_program.key();
    assert_call_target_allowed(
        &ctx.accounts.global,
        ctx.accounts.allowed_targets.as_deref(),
        &token_program_key,
    )?;
    if let Some(g) = resolve_hook_allowlist(
        &ctx.accounts.global,
        ctx.accounts.hook_allowlist.as_ref(),
    )? {
        assert_hook_allowed_at_site(
            &ctx.accounts.mint.to_account_info(),
            g,
            None,
            SITE_FUND_TREASURY,
        )
        .map_err(|_| error!(TreasuryError::HookNotAllowed))?;
    }
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.funder_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.funder.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(token_program_key, cpi_accounts);
    transfer_checked(cpi_ctx, amount, decimals)?;

    emit!(TreasuryFunded {
        agent_did: ctx.accounts.treasury.agent_did,
        mint: mint_key,
        amount,
        funder: ctx.accounts.funder.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
