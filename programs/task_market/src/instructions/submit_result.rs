use anchor_lang::prelude::*;

use agent_registry::program::AgentRegistry;
use agent_registry::state::{AgentAccount, AgentStatus};

use crate::errors::TaskMarketError;
use crate::events::{GuardEntered, ResultSubmitted};
use crate::guard::{exit as guard_exit, try_enter, ReentrancyGuard, SEED_GUARD};
use crate::state::{MarketGlobal, TaskContract, TaskStatus};

#[derive(Accounts)]
pub struct SubmitResult<'info> {
    #[account(seeds = [b"market_global"], bump = global.bump)]
    pub global: Box<Account<'info, MarketGlobal>>,

    #[account(
        mut,
        seeds = [b"task", task.client.as_ref(), task.task_nonce.as_ref()],
        bump = task.bump,
    )]
    pub task: Box<Account<'info, TaskContract>>,

    pub operator: Signer<'info>,

    #[account(
        constraint = agent_registry_program.key() == global.agent_registry @ TaskMarketError::Unauthorized,
    )]
    pub agent_registry_program: Program<'info, AgentRegistry>,

    // F-2026-05: did-equality check is deferred to the handler so that a
    // commit-reveal winner (DID ≠ task.agent_did) is not struct-rejected.
    #[account(
        seeds = [b"agent", agent_account.operator.as_ref(), agent_account.agent_id.as_ref()],
        bump = agent_account.bump,
        seeds::program = agent_registry_program.key(),
        constraint = agent_account.operator == operator.key() @ TaskMarketError::CallerNotOperator,
    )]
    pub agent_account: Box<Account<'info, AgentAccount>>,

    #[account(mut, seeds = [SEED_GUARD], bump = guard.bump)]
    pub guard: Box<Account<'info, ReentrancyGuard>>,
}

pub fn handler(
    ctx: Context<SubmitResult>,
    result_hash: [u8; 32],
    proof_key: [u8; 32],
) -> Result<()> {
    let clock = Clock::get()?;
    try_enter(&mut ctx.accounts.guard, crate::ID, clock.slot)?;
    emit!(GuardEntered {
        program: crate::ID,
        caller: crate::ID,
        slot: clock.slot,
        stack_height: 1,
    });

    let t = &mut ctx.accounts.task;
    require!(t.status == TaskStatus::Funded, TaskMarketError::WrongStatus);
    require!(result_hash != [0u8; 32], TaskMarketError::ZeroResultHash);

    let now = clock.unix_timestamp;
    require!(now <= t.deadline, TaskMarketError::DeadlinePassed);

    require!(
        ctx.accounts.agent_account.status == AgentStatus::Active,
        TaskMarketError::AgentNotActive,
    );

    if t.bid_book.is_some() {
        require!(
            t.assigned_agent == Some(ctx.accounts.agent_account.key()),
            TaskMarketError::AgentMismatch,
        );
    } else {
        require!(
            ctx.accounts.agent_account.did == t.agent_did,
            TaskMarketError::AgentMismatch,
        );
    }

    t.result_hash = result_hash;
    t.proof_key = proof_key;
    t.submitted_at = now;
    t.status = TaskStatus::ProofSubmitted;

    emit!(ResultSubmitted {
        task_id: t.task_id,
        result_hash,
        proof_key,
        submitted_at: now,
        timestamp: now,
    });

    guard_exit(&mut ctx.accounts.guard);
    Ok(())
}
