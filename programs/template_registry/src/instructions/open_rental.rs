use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::errors::TemplateRegistryError;
use crate::events::RentalOpened;
use crate::state::{AgentTemplate, TemplateRegistryGlobal, TemplateRental, TemplateStatus, RentalStatus};

#[derive(Accounts)]
#[instruction(duration_secs: i64, rental_nonce: [u8; 8])]
pub struct OpenRental<'info> {
    #[account(seeds = [b"tpl_global"], bump = global.bump)]
    pub global: Box<Account<'info, TemplateRegistryGlobal>>,

    #[account(
        seeds = [b"template", template.template_id.as_ref()],
        bump = template.bump,
    )]
    pub template: Box<Account<'info, AgentTemplate>>,

    #[account(
        init,
        payer = renter,
        space = 8 + TemplateRental::INIT_SPACE,
        seeds = [b"rental", template.key().as_ref(), renter.key().as_ref(), rental_nonce.as_ref()],
        bump,
    )]
    pub rental: Box<Account<'info, TemplateRental>>,

    #[account(address = global.rent_escrow_mint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = renter,
        token::mint = mint,
        token::authority = escrow,
        seeds = [b"rental_escrow", rental.key().as_ref()],
        bump,
    )]
    pub escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = mint)]
    pub renter_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub renter: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<OpenRental>,
    duration_secs: i64,
    _rental_nonce: [u8; 8],
) -> Result<()> {
    require!(!ctx.accounts.global.paused, TemplateRegistryError::Paused);

    let t = &ctx.accounts.template;
    require!(t.status == TemplateStatus::Published, TemplateRegistryError::InvalidStatus);
    require!(t.rent_price_per_sec > 0, TemplateRegistryError::RentalDisabled);
    require!(
        duration_secs >= t.min_rent_duration && duration_secs <= t.max_rent_duration,
        TemplateRegistryError::RentalDurationOutOfBounds,
    );

    let prepaid = (t.rent_price_per_sec as u128)
        .checked_mul(duration_secs as u128)
        .ok_or(TemplateRegistryError::ArithmeticOverflow)?;
    let prepaid: u64 = prepaid.try_into().map_err(|_| TemplateRegistryError::ArithmeticOverflow)?;

    let now = Clock::get()?.unix_timestamp;

    // transfer prepaid to escrow
    let cpi = TransferChecked {
        from: ctx.accounts.renter_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.escrow.to_account_info(),
        authority: ctx.accounts.renter.to_account_info(),
    };
    transfer_checked(
        CpiContext::new(ctx.accounts.token_program.key(), cpi),
        prepaid,
        ctx.accounts.mint.decimals,
    )?;

    let rental = &mut ctx.accounts.rental;
    rental.template = ctx.accounts.template.key();
    rental.renter = ctx.accounts.renter.key();
    rental.start_time = now;
    rental.end_time = now.checked_add(duration_secs).ok_or(TemplateRegistryError::ArithmeticOverflow)?;
    rental.prepaid_amount = prepaid;
    rental.drip_rate_per_sec = t.rent_price_per_sec;
    rental.claimed_author = 0;
    rental.claimed_platform = 0;
    rental.status = RentalStatus::Active;
    rental.bump = ctx.bumps.rental;
    rental.escrow_bump = ctx.bumps.escrow;

    emit!(RentalOpened {
        template: ctx.accounts.template.key(),
        renter: ctx.accounts.renter.key(),
        start: now,
        end: rental.end_time,
        prepaid,
    });

    Ok(())
}
