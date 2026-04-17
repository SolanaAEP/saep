use anchor_lang::prelude::*;

use crate::errors::TaskMarketError;
use crate::state::{Bid, BidBook, BidPhase, TaskContract, SEED_BID, SEED_BID_BOOK};

#[derive(Accounts)]
pub struct CloseBid<'info> {
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
        close = bidder,
        seeds = [SEED_BID, task.task_id.as_ref(), bidder.key().as_ref()],
        bump = bid.bump,
        constraint = bid.bidder == bidder.key() @ TaskMarketError::Unauthorized,
    )]
    pub bid: Box<Account<'info, Bid>>,

    #[account(mut)]
    pub bidder: Signer<'info>,
}

pub fn handler(ctx: Context<CloseBid>) -> Result<()> {
    let book = &ctx.accounts.bid_book;
    require!(
        book.phase == BidPhase::Settled || book.phase == BidPhase::Cancelled,
        TaskMarketError::BidBookNotSettled
    );

    let bid = &ctx.accounts.bid;
    require!(bid.refunded, TaskMarketError::BondNotClaimed);

    Ok(())
}
