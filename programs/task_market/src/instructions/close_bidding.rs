use anchor_lang::prelude::*;

use agent_registry::state::AgentAccount;

use crate::errors::TaskMarketError;
use crate::events::{BidBookClosed, GuardEntered};
use crate::guard::{exit as guard_exit, try_enter, ReentrancyGuard, SEED_GUARD};
use crate::state::{
    bid_beats, Bid, BidBook, BidPhase, MarketGlobal, TaskContract, TaskStatus, SEED_BID,
    SEED_BID_BOOK,
};

#[derive(Accounts)]
pub struct CloseBidding<'info> {
    #[account(seeds = [b"market_global"], bump = global.bump)]
    pub global: Box<Account<'info, MarketGlobal>>,

    #[account(
        mut,
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

    #[account(mut, seeds = [SEED_GUARD], bump = guard.bump)]
    pub guard: Box<Account<'info, ReentrancyGuard>>,

    pub cranker: Signer<'info>,
}

pub fn handler<'info>(ctx: Context<'info, CloseBidding<'info>>) -> Result<()> {
    let clock = Clock::get()?;
    try_enter(&mut ctx.accounts.guard, crate::ID, clock.slot)?;
    emit!(GuardEntered {
        program: crate::ID,
        caller: crate::ID,
        slot: clock.slot,
        stack_height: 1,
    });

    let book = &mut ctx.accounts.bid_book;
    require!(
        book.phase == BidPhase::Commit || book.phase == BidPhase::Reveal,
        TaskMarketError::PhaseClosed
    );

    let now = clock.unix_timestamp;
    require!(now >= book.reveal_end, TaskMarketError::PhaseClosed);

    let task_id = ctx.accounts.task.task_id;
    let agent_registry = ctx.accounts.global.agent_registry;
    let remaining = ctx.remaining_accounts;
    require!(
        remaining.len() % 2 == 0,
        TaskMarketError::Unauthorized
    );
    // F-2026-07: cranker must submit every revealed bid (each as a
    // [Bid, AgentAccount] pair). Otherwise a partial submission could
    // settle on a suboptimal winner.
    require!(
        remaining.len() == (book.reveal_count as usize) * 2,
        TaskMarketError::IncompleteBidEnumeration,
    );

    let mut winner_agent: Option<Pubkey> = None;
    let mut winner_did: Option<[u8; 32]> = None;
    let mut winner_amount: u64 = 0;
    let mut winner_stake: u64 = 0;
    let mut seen_bidders: Vec<Pubkey> = Vec::with_capacity(remaining.len() / 2);

    let mut i = 0usize;
    while i < remaining.len() {
        let bid_ai = &remaining[i];
        let agent_ai = &remaining[i + 1];

        let bid: Account<'info, Bid> = Account::try_from(bid_ai)?;
        require!(bid.task_id == task_id, TaskMarketError::TaskNotFound);
        let expected_bid_pda = Pubkey::create_program_address(
            &[
                SEED_BID,
                &task_id,
                bid.bidder.as_ref(),
                core::slice::from_ref(&bid.bump),
            ],
            &crate::ID,
        )
        .map_err(|_| TaskMarketError::Unauthorized)?;
        require!(
            bid_ai.key() == expected_bid_pda,
            TaskMarketError::Unauthorized
        );

        // F-2026-07: reject duplicates so a cranker can't double-count a
        // single bid to pad `reveal_count`.
        require!(
            !seen_bidders.iter().any(|b| b == &bid.bidder),
            TaskMarketError::DuplicateBidEnumeration
        );
        seen_bidders.push(bid.bidder);

        // F-2026-13: every enumerated pair must be a revealed, unslashed bid.
        // Allowing `continue` on `!revealed || slashed` lets a cranker
        // substitute a sacrificial committed-but-unrevealed bid for an
        // honest revealed one while still satisfying `remaining.len() ==
        // reveal_count * 2`, pushing a suboptimal winner.
        require!(
            bid.revealed && !bid.slashed,
            TaskMarketError::InvalidBidInEnumeration
        );

        require!(
            agent_ai.owner == &agent_registry,
            TaskMarketError::Unauthorized
        );
        let agent: Account<'info, AgentAccount> = Account::try_from(agent_ai)?;
        require!(
            agent.did == bid.agent_did,
            TaskMarketError::AgentMismatch
        );

        let candidate_amount = bid.revealed_amount;
        let candidate_stake = agent.stake_amount;
        let candidate_key = agent_ai.key();

        let take = match winner_agent {
            None => true,
            Some(current_key) => bid_beats(
                candidate_amount,
                candidate_stake,
                &candidate_key,
                winner_amount,
                winner_stake,
                &current_key,
            ),
        };

        if take {
            winner_agent = Some(candidate_key);
            winner_did = Some(agent.did);
            winner_amount = candidate_amount;
            winner_stake = candidate_stake;
        }

        i += 2;
    }

    let reveal_count = book.reveal_count;

    if let Some(w) = winner_agent {
        book.phase = BidPhase::Settled;
        book.winner_agent = Some(w);
        book.winner_amount = winner_amount;
        ctx.accounts.task.assigned_agent = Some(w);
        // F-2026-05: rewrite task.agent_did to the winning bidder's DID so
        // downstream ix (submit_result/release/expire) that consult
        // task.agent_did observe a consistent value.
        if let Some(did) = winner_did {
            ctx.accounts.task.agent_did = did;
        }
    } else {
        book.phase = BidPhase::Cancelled;
        book.winner_agent = None;
        book.winner_amount = 0;
        // F-2026-07: when no revealed bid survives, reset task.status to
        // Funded so the client can re-open bidding per spec §Invariant 5.
        ctx.accounts.task.status = TaskStatus::Funded;
        // Detach the now-cancelled bid book so re-open_bidding can attach a
        // fresh one without hitting `BidBookAlreadyOpen`.
        ctx.accounts.task.bid_book = None;
    }

    emit!(BidBookClosed {
        task_id,
        winner_agent,
        winner_amount: book.winner_amount,
        reveal_count,
    });

    guard_exit(&mut ctx.accounts.guard);
    Ok(())
}
