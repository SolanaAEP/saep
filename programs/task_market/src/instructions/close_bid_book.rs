use anchor_lang::prelude::*;
use anchor_spl::token_interface::{close_account, CloseAccount, TokenInterface};
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::errors::TaskMarketError;
use crate::state::{BidBook, BidPhase, TaskContract, SEED_BID_BOOK, SEED_BOND_ESCROW};

#[derive(Accounts)]
pub struct CloseBidBook<'info> {
    #[account(
        mut,
        seeds = [b"task", task.client.as_ref(), task.task_nonce.as_ref()],
        bump = task.bump,
        has_one = client @ TaskMarketError::Unauthorized,
    )]
    pub task: Box<Account<'info, TaskContract>>,

    #[account(
        mut,
        close = client,
        seeds = [SEED_BID_BOOK, task.task_id.as_ref()],
        bump = bid_book.bump,
        constraint = task.bid_book == Some(bid_book.key()) @ TaskMarketError::Unauthorized,
    )]
    pub bid_book: Box<Account<'info, BidBook>>,

    #[account(address = task.payment_mint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [SEED_BOND_ESCROW, task.task_id.as_ref()],
        bump = bid_book.escrow_bump,
        token::mint = payment_mint,
    )]
    pub bond_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub client: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<CloseBidBook>) -> Result<()> {
    let book = &ctx.accounts.bid_book;
    require!(
        book.phase == BidPhase::Settled || book.phase == BidPhase::Cancelled,
        TaskMarketError::BidBookNotSettled
    );

    require!(
        ctx.accounts.bond_escrow.amount == 0,
        TaskMarketError::EscrowNotEmpty
    );

    let task_id = ctx.accounts.task.task_id;
    let escrow_bump = book.escrow_bump;

    let seeds: &[&[u8]] = &[
        SEED_BOND_ESCROW,
        task_id.as_ref(),
        core::slice::from_ref(&escrow_bump),
    ];
    let signer = &[seeds];

    let cpi = CloseAccount {
        account: ctx.accounts.bond_escrow.to_account_info(),
        destination: ctx.accounts.client.to_account_info(),
        authority: ctx.accounts.bond_escrow.to_account_info(),
    };
    let ctx_cpi = CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi, signer);
    close_account(ctx_cpi)?;

    ctx.accounts.task.bid_book = None;

    Ok(())
}
