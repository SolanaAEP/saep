use anchor_lang::prelude::*;

use crate::errors::TaskMarketError;
use crate::events::BidRevealed;
use crate::state::{
    reveal_commit_hash, Bid, BidBook, BidPhase, TaskContract, SEED_BID, SEED_BID_BOOK,
};

#[derive(Accounts)]
pub struct RevealBid<'info> {
    #[account(
        seeds = [b"task", task.client.as_ref(), task.task_nonce.as_ref()],
        bump = task.bump,
    )]
    pub task: Box<Account<'info, TaskContract>>,

    #[account(
        mut,
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

    pub bidder: Signer<'info>,
}

pub fn handler(
    ctx: Context<RevealBid>,
    amount: u64,
    nonce: [u8; 32],
) -> Result<()> {
    let book = &mut ctx.accounts.bid_book;
    require!(
        book.phase == BidPhase::Commit || book.phase == BidPhase::Reveal,
        TaskMarketError::PhaseClosed
    );

    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= book.commit_end && now < book.reveal_end,
        TaskMarketError::PhaseClosed
    );

    let bid = &mut ctx.accounts.bid;
    require!(!bid.revealed, TaskMarketError::WrongStatus);
    require!(!bid.slashed, TaskMarketError::WrongStatus);

    let preimage = reveal_commit_hash(amount, &nonce, &bid.agent_did);

    // Spec §79: hash mismatch records slashable state and returns Ok so the
    // mutation persists — if we returned Err, the tx would roll back and the
    // slash flag would never land. Bond is then redirected to fee_collector
    // at claim_bond time.
    if preimage != bid.commit_hash {
        bid.slashed = true;
        emit!(BidRevealed {
            task_id: bid.task_id,
            bidder: bid.bidder,
            amount: 0,
        });
        return Ok(());
    }

    bid.revealed_amount = amount;
    bid.revealed = true;
    book.reveal_count = book
        .reveal_count
        .checked_add(1)
        .ok_or(TaskMarketError::ArithmeticOverflow)?;

    emit!(BidRevealed {
        task_id: bid.task_id,
        bidder: bid.bidder,
        amount,
    });
    Ok(())
}
