use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::errors::TemplateRegistryError;
use crate::events::RentalClosed;
use crate::state::{AgentTemplate, TemplateRegistryGlobal, TemplateRental, RentalStatus};

#[derive(Accounts)]
pub struct CloseRental<'info> {
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

    #[account(mut, token::mint = mint)]
    pub author_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = mint)]
    pub fee_collector_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = mint)]
    pub renter_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub signer: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<CloseRental>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let rental = &ctx.accounts.rental;

    let is_renter = ctx.accounts.signer.key() == rental.renter;
    let is_after_end = now >= rental.end_time;

    // only renter can close early; anyone can close after end_time
    require!(is_renter || is_after_end, TemplateRegistryError::Unauthorized);

    // compute final accrual
    let effective_end = std::cmp::min(now, rental.end_time);
    let elapsed = effective_end.saturating_sub(rental.start_time) as u128;
    let total_accrued = elapsed
        .checked_mul(rental.drip_rate_per_sec as u128)
        .ok_or(TemplateRegistryError::ArithmeticOverflow)?;

    let already_claimed = (rental.claimed_author as u128) + (rental.claimed_platform as u128);
    let remaining_accrual = total_accrued.saturating_sub(already_claimed);
    let remaining_accrual: u64 = remaining_accrual.try_into().map_err(|_| TemplateRegistryError::ArithmeticOverflow)?;

    let rental_key = ctx.accounts.rental.key();
    let seeds: &[&[u8]] = &[
        b"rental_escrow",
        rental_key.as_ref(),
        core::slice::from_ref(&rental.escrow_bump),
    ];
    let signer_seeds = &[seeds];
    let decimals = ctx.accounts.mint.decimals;

    let platform_fee_bps = ctx.accounts.global.platform_fee_bps as u64;
    let royalty_bps = ctx.accounts.template.royalty_bps as u64;

    // pay remaining accrual to author + platform
    if remaining_accrual > 0 {
        let platform_fee = remaining_accrual.checked_mul(platform_fee_bps).and_then(|v| v.checked_div(10_000)).unwrap_or(0);
        let author_royalty = remaining_accrual.checked_mul(royalty_bps).and_then(|v| v.checked_div(10_000)).unwrap_or(0);

        if author_royalty > 0 {
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        from: ctx.accounts.escrow.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.author_token_account.to_account_info(),
                        authority: ctx.accounts.escrow.to_account_info(),
                    },
                    signer_seeds,
                ),
                author_royalty,
                decimals,
            )?;
        }

        if platform_fee > 0 {
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        from: ctx.accounts.escrow.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.fee_collector_token_account.to_account_info(),
                        authority: ctx.accounts.escrow.to_account_info(),
                    },
                    signer_seeds,
                ),
                platform_fee,
                decimals,
            )?;
        }
    }

    // refund remaining escrow balance to renter
    ctx.accounts.escrow.reload()?;
    let refund = ctx.accounts.escrow.amount;
    if refund > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.escrow.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.renter_token_account.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                signer_seeds,
            ),
            refund,
            decimals,
        )?;
    }

    let rental = &mut ctx.accounts.rental;
    rental.status = if is_renter && !is_after_end {
        RentalStatus::Cancelled
    } else {
        RentalStatus::Closed
    };

    emit!(RentalClosed {
        rental: ctx.accounts.rental.key(),
        refund,
        timestamp: now,
    });

    Ok(())
}
