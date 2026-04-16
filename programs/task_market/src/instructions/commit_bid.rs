use anchor_lang::prelude::*;
use anchor_spl::token_2022::{transfer_checked, Token2022, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount};

use agent_registry::program::AgentRegistry;
use agent_registry::state::{AgentAccount, AgentStatus};

use crate::errors::TaskMarketError;
use crate::events::BidCommitted;
use crate::state::{
    Bid, BidBook, BidPhase, MarketGlobal, TaskContract, MAX_BIDDERS_PER_TASK, SEED_BID,
    SEED_BID_BOOK, SEED_BOND_ESCROW,
};

#[derive(Accounts)]
#[instruction(commit_hash: [u8; 32], agent_did: [u8; 32])]
pub struct CommitBid<'info> {
    #[account(seeds = [b"market_global"], bump = global.bump)]
    pub global: Box<Account<'info, MarketGlobal>>,

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
        init,
        payer = bidder,
        space = 8 + Bid::INIT_SPACE,
        seeds = [SEED_BID, task.task_id.as_ref(), bidder.key().as_ref()],
        bump,
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

    #[account(mut)]
    pub bidder: Signer<'info>,

    #[account(
        constraint = agent_registry_program.key() == global.agent_registry @ TaskMarketError::Unauthorized,
    )]
    pub agent_registry_program: Program<'info, AgentRegistry>,

    #[account(
        seeds = [b"agent", agent_account.operator.as_ref(), agent_account.agent_id.as_ref()],
        bump = agent_account.bump,
        seeds::program = agent_registry_program.key(),
        constraint = agent_account.operator == bidder.key() @ TaskMarketError::CallerNotOperator,
        constraint = agent_account.did == agent_did @ TaskMarketError::AgentMismatch,
    )]
    pub agent_account: Box<Account<'info, AgentAccount>>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CommitBid>,
    commit_hash: [u8; 32],
    agent_did: [u8; 32],
) -> Result<()> {
    require!(!ctx.accounts.global.paused, TaskMarketError::Paused);
    require!(
        ctx.accounts.agent_account.status == AgentStatus::Active,
        TaskMarketError::AgentNotActive,
    );

    let book = &mut ctx.accounts.bid_book;
    require!(book.phase == BidPhase::Commit, TaskMarketError::PhaseClosed);

    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= book.commit_start && now < book.commit_end,
        TaskMarketError::PhaseClosed
    );
    require!(
        book.commit_count < MAX_BIDDERS_PER_TASK,
        TaskMarketError::TooManyBidders
    );

    let bond_amount = book.bond_amount;
    let decimals = ctx.accounts.payment_mint.decimals;
    let task_id = ctx.accounts.task.task_id;
    let bidder_key = ctx.accounts.bidder.key();

    let bid = &mut ctx.accounts.bid;
    bid.task_id = task_id;
    bid.agent_did = agent_did;
    bid.bidder = bidder_key;
    bid.commit_hash = commit_hash;
    bid.bond_paid = bond_amount;
    bid.revealed_amount = 0;
    bid.revealed = false;
    bid.refunded = false;
    bid.slashed = false;
    bid.bump = ctx.bumps.bid;

    book.commit_count = book
        .commit_count
        .checked_add(1)
        .ok_or(TaskMarketError::ArithmeticOverflow)?;

    if bond_amount > 0 {
        let cpi = TransferChecked {
            from: ctx.accounts.bidder_token_account.to_account_info(),
            mint: ctx.accounts.payment_mint.to_account_info(),
            to: ctx.accounts.bond_escrow.to_account_info(),
            authority: ctx.accounts.bidder.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi);
        transfer_checked(cpi_ctx, bond_amount, decimals)?;
    }

    emit!(BidCommitted {
        task_id,
        bidder: bidder_key,
        bond_paid: bond_amount,
    });
    Ok(())
}
