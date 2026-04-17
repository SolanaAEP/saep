use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenInterface;
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::errors::TaskMarketError;
use crate::events::BidBookOpened;
use crate::state::{
    compute_bond_amount, BidBook, BidPhase, MarketGlobal, TaskContract, TaskStatus,
    MAX_BID_BOND_BPS, MIN_BID_BOND_BPS, SEED_BID_BOOK, SEED_BOND_ESCROW,
};

#[derive(Accounts)]
pub struct OpenBidding<'info> {
    #[account(seeds = [b"market_global"], bump = global.bump)]
    pub global: Box<Account<'info, MarketGlobal>>,

    #[account(
        mut,
        seeds = [b"task", task.client.as_ref(), task.task_nonce.as_ref()],
        bump = task.bump,
        has_one = client @ TaskMarketError::Unauthorized,
    )]
    pub task: Box<Account<'info, TaskContract>>,

    #[account(
        init,
        payer = client,
        space = 8 + BidBook::INIT_SPACE,
        seeds = [SEED_BID_BOOK, task.task_id.as_ref()],
        bump,
    )]
    pub bid_book: Box<Account<'info, BidBook>>,

    #[account(address = task.payment_mint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = client,
        seeds = [SEED_BOND_ESCROW, task.task_id.as_ref()],
        bump,
        token::mint = payment_mint,
        token::authority = bond_escrow,
    )]
    pub bond_escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub client: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<OpenBidding>,
    commit_secs: i64,
    reveal_secs: i64,
    bond_bps: u16,
) -> Result<()> {
    require!(!ctx.accounts.global.paused, TaskMarketError::Paused);
    require!(
        ctx.accounts.task.status == TaskStatus::Funded,
        TaskMarketError::WrongStatus
    );
    require!(
        ctx.accounts.task.bid_book.is_none(),
        TaskMarketError::BidBookAlreadyOpen
    );
    require!(
        bond_bps >= MIN_BID_BOND_BPS && bond_bps <= MAX_BID_BOND_BPS,
        TaskMarketError::BondOutOfRange
    );
    require!(
        commit_secs > 0 && reveal_secs > 0,
        TaskMarketError::WindowInvalid
    );

    let now = Clock::get()?.unix_timestamp;
    let commit_end = now
        .checked_add(commit_secs)
        .ok_or(TaskMarketError::ArithmeticOverflow)?;
    let reveal_end = commit_end
        .checked_add(reveal_secs)
        .ok_or(TaskMarketError::ArithmeticOverflow)?;
    require!(
        reveal_end <= ctx.accounts.task.deadline,
        TaskMarketError::WindowInvalid
    );

    let bond_amount = compute_bond_amount(ctx.accounts.task.payment_amount, bond_bps)?;

    let task_id = ctx.accounts.task.task_id;
    let payment_mint = ctx.accounts.task.payment_mint;

    let bid_book_key = ctx.accounts.bid_book.key();
    let bid_book = &mut ctx.accounts.bid_book;
    bid_book.task_id = task_id;
    bid_book.commit_start = now;
    bid_book.commit_end = commit_end;
    bid_book.reveal_end = reveal_end;
    bid_book.bond_amount = bond_amount;
    bid_book.bond_mint = payment_mint;
    bid_book.commit_count = 0;
    bid_book.reveal_count = 0;
    bid_book.winner_agent = None;
    bid_book.winner_amount = 0;
    bid_book.phase = BidPhase::Commit;
    bid_book.bump = ctx.bumps.bid_book;
    bid_book.escrow_bump = ctx.bumps.bond_escrow;

    ctx.accounts.task.bid_book = Some(bid_book_key);

    emit!(BidBookOpened {
        task_id,
        commit_end,
        reveal_end,
        bond_amount,
    });
    Ok(())
}
