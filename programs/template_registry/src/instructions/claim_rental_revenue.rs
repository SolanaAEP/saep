use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::errors::TemplateRegistryError;
use crate::events::RentalRevenueClaimed;
use crate::state::{AgentTemplate, TemplateRegistryGlobal, TemplateRental, RentalStatus};

#[derive(Accounts)]
pub struct ClaimRentalRevenue<'info> {
    #[account(seeds = [b"tpl_global"], bump = global.bump)]
    pub global: Box<Account<'info, TemplateRegistryGlobal>>,

    #[account(
        seeds = [b"template", template.template_id.as_ref()],
        bump = template.bump,
    )]
    pub template: Box<Account<'info, AgentTemplate>>,

    #[account(
        mut,
        constraint = rental.template == template.key(),
        constraint = rental.status == RentalStatus::Active @ TemplateRegistryError::RentalAlreadyClosed,
    )]
    pub rental: Box<Account<'info, TemplateRental>>,

    #[account(address = global.rent_escrow_mint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [b"rental_escrow", rental.key().as_ref()],
        bump = rental.escrow_bump,
        token::mint = mint,
    )]
    pub escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = mint,
        constraint = author_token_account.owner == template.author @ TemplateRegistryError::Unauthorized,
    )]
    pub author_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = mint,
        constraint = fee_collector_token_account.key() == global.fee_collector @ TemplateRegistryError::Unauthorized,
    )]
    pub fee_collector_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub cranker: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<ClaimRentalRevenue>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let rental = &ctx.accounts.rental;

    if now <= rental.start_time {
        return err!(TemplateRegistryError::NothingToClaim);
    }

    let effective_end = std::cmp::min(now, rental.end_time);
    let elapsed = (effective_end - rental.start_time) as u128;
    let total_accrued = elapsed
        .checked_mul(rental.drip_rate_per_sec as u128)
        .ok_or(TemplateRegistryError::ArithmeticOverflow)?;

    let already_claimed = (rental.claimed_author as u128) + (rental.claimed_platform as u128);
    let claimable = total_accrued
        .checked_sub(already_claimed)
        .ok_or(TemplateRegistryError::ArithmeticOverflow)?;

    if claimable == 0 {
        return err!(TemplateRegistryError::NothingToClaim);
    }

    let claimable: u64 = claimable.try_into().map_err(|_| TemplateRegistryError::ArithmeticOverflow)?;

    let platform_fee_bps = ctx.accounts.global.platform_fee_bps as u64;
    let royalty_bps = ctx.accounts.template.royalty_bps as u64;

    let platform_fee = claimable
        .checked_mul(platform_fee_bps)
        .and_then(|v| v.checked_div(10_000))
        .ok_or(TemplateRegistryError::ArithmeticOverflow)?;
    let author_royalty = claimable
        .checked_mul(royalty_bps)
        .and_then(|v| v.checked_div(10_000))
        .ok_or(TemplateRegistryError::ArithmeticOverflow)?;
    let renter_retained = claimable
        .checked_sub(platform_fee)
        .and_then(|v| v.checked_sub(author_royalty))
        .ok_or(TemplateRegistryError::ArithmeticOverflow)?;

    let rental_key = ctx.accounts.rental.key();
    let seeds: &[&[u8]] = &[
        b"rental_escrow",
        rental_key.as_ref(),
        core::slice::from_ref(&ctx.accounts.rental.escrow_bump),
    ];
    let signer = &[seeds];
    let decimals = ctx.accounts.mint.decimals;

    if author_royalty > 0 {
        let cpi = TransferChecked {
            from: ctx.accounts.escrow.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.author_token_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        transfer_checked(
            CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi, signer),
            author_royalty,
            decimals,
        )?;
    }

    if platform_fee > 0 {
        let cpi = TransferChecked {
            from: ctx.accounts.escrow.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.fee_collector_token_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        transfer_checked(
            CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi, signer),
            platform_fee,
            decimals,
        )?;
    }

    let rental = &mut ctx.accounts.rental;
    rental.claimed_author = rental.claimed_author.checked_add(author_royalty).ok_or(TemplateRegistryError::ArithmeticOverflow)?;
    rental.claimed_platform = rental.claimed_platform.checked_add(platform_fee).ok_or(TemplateRegistryError::ArithmeticOverflow)?;

    emit!(RentalRevenueClaimed {
        rental: ctx.accounts.rental.key(),
        platform_fee,
        author_royalty,
        renter_retained,
    });

    Ok(())
}
