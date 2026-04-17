use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, TokenInterface, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount};

use fee_collector::{
    assert_hook_allowed_at_site, HookAllowlist, SITE_CLAIM_BOND_REFUND, SITE_CLAIM_BOND_SLASH,
};

use crate::errors::TaskMarketError;
use crate::events::BidSlashed;
use crate::state::{
    resolve_hook_allowlist, Bid, BidBook, BidPhase, MarketGlobal, TaskContract, SEED_BID,
    SEED_BID_BOOK, SEED_BOND_ESCROW,
};

#[derive(Accounts)]
pub struct ClaimBond<'info> {
    #[account(seeds = [b"market_global"], bump = global.bump)]
    pub global: Box<Account<'info, MarketGlobal>>,

    #[account(
        seeds = [b"task", task.client.as_ref(), task.task_nonce.as_ref()],
        bump = task.bump,
    )]
    pub task: Box<Account<'info, TaskContract>>,

    #[account(
        seeds = [SEED_BID_BOOK, task.task_id.as_ref()],
        bump = bid_book.bump,
        constraint = task.bid_book == Some(bid_book.key()) @ TaskMarketError::Unauthorized,
    )]
    pub bid_book: Box<Account<'info, BidBook>>,

    #[account(
        mut,
        seeds = [SEED_BID, task.task_id.as_ref(), bidder.key().as_ref()],
        bump = bid.bump,
        constraint = bid.bidder == bidder.key() @ TaskMarketError::Unauthorized,
    )]
    pub bid: Box<Account<'info, Bid>>,

    #[account(address = task.payment_mint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [SEED_BOND_ESCROW, task.task_id.as_ref()],
        bump = bid_book.escrow_bump,
        token::mint = payment_mint,
    )]
    pub bond_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = payment_mint, token::authority = bidder)]
    pub bidder_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = payment_mint)]
    pub fee_collector_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub hook_allowlist: Option<Account<'info, HookAllowlist>>,

    pub bidder: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

enum Outcome {
    WinnerRetain,
    Refund,
    Slash,
}

pub fn handler(ctx: Context<ClaimBond>) -> Result<()> {
    let book = &ctx.accounts.bid_book;
    require!(
        book.phase == BidPhase::Settled || book.phase == BidPhase::Cancelled,
        TaskMarketError::BidBookNotSettled
    );

    let bid = &ctx.accounts.bid;
    require!(!bid.refunded, TaskMarketError::AlreadyRefunded);

    let outcome = match book.phase {
        BidPhase::Cancelled => Outcome::Refund,
        BidPhase::Settled => {
            if !bid.revealed || bid.slashed {
                Outcome::Slash
            } else if book
                .winner_bidder
                .map(|w| w == ctx.accounts.bidder.key())
                .unwrap_or(false)
            {
                Outcome::WinnerRetain
            } else {
                Outcome::Refund
            }
        }
        _ => return err!(TaskMarketError::BidBookNotSettled),
    };

    let task_id = bid.task_id;
    let bond_paid = bid.bond_paid;
    let bidder_key = bid.bidder;
    let escrow_bump = book.escrow_bump;
    let decimals = ctx.accounts.payment_mint.decimals;

    // State-before-CPI: mark refunded prior to any transfer.
    {
        let b = &mut ctx.accounts.bid;
        b.refunded = true;
        if matches!(outcome, Outcome::Slash) {
            b.slashed = true;
        }
    }

    if bond_paid > 0 && !matches!(outcome, Outcome::WinnerRetain) {
        if let Some(g) = resolve_hook_allowlist(
            &ctx.accounts.global,
            ctx.accounts.hook_allowlist.as_ref(),
        )? {
            let site = match outcome {
                Outcome::Refund => SITE_CLAIM_BOND_REFUND,
                Outcome::Slash => SITE_CLAIM_BOND_SLASH,
                Outcome::WinnerRetain => unreachable!(),
            };
            assert_hook_allowed_at_site(
                &ctx.accounts.payment_mint.to_account_info(),
                g,
                None,
                site,
            )
            .map_err(|_| error!(TaskMarketError::HookNotAllowed))?;
        }

        let seeds: &[&[u8]] = &[
            SEED_BOND_ESCROW,
            task_id.as_ref(),
            core::slice::from_ref(&escrow_bump),
        ];
        let signer = &[seeds];

        let destination = match outcome {
            Outcome::Refund => ctx.accounts.bidder_token_account.to_account_info(),
            Outcome::Slash => ctx.accounts.fee_collector_token_account.to_account_info(),
            Outcome::WinnerRetain => unreachable!(),
        };

        let cpi = TransferChecked {
            from: ctx.accounts.bond_escrow.to_account_info(),
            mint: ctx.accounts.payment_mint.to_account_info(),
            to: destination,
            authority: ctx.accounts.bond_escrow.to_account_info(),
        };
        let ctx_cpi = CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi, signer);
        transfer_checked(ctx_cpi, bond_paid, decimals)?;
    }

    if matches!(outcome, Outcome::Slash) {
        emit!(BidSlashed {
            task_id,
            bidder: bidder_key,
            bond_amount: bond_paid,
        });
    }

    Ok(())
}
