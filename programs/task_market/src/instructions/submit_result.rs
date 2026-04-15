use anchor_lang::prelude::*;

use agent_registry::program::AgentRegistry;
use agent_registry::state::{AgentAccount, AgentStatus};

use crate::errors::TaskMarketError;
use crate::events::ResultSubmitted;
use crate::state::{MarketGlobal, TaskContract, TaskStatus};

#[derive(Accounts)]
pub struct SubmitResult<'info> {
    #[account(seeds = [b"market_global"], bump = global.bump)]
    pub global: Account<'info, MarketGlobal>,

    #[account(
        mut,
        seeds = [b"task", task.client.as_ref(), task.task_nonce.as_ref()],
        bump = task.bump,
    )]
    pub task: Account<'info, TaskContract>,

    pub operator: Signer<'info>,

    #[account(
        constraint = agent_registry_program.key() == global.agent_registry @ TaskMarketError::Unauthorized,
    )]
    pub agent_registry_program: Program<'info, AgentRegistry>,

    #[account(
        seeds = [b"agent", agent_account.operator.as_ref(), agent_account.agent_id.as_ref()],
        bump = agent_account.bump,
        seeds::program = agent_registry_program.key(),
        constraint = agent_account.did == task.agent_did @ TaskMarketError::AgentMismatch,
        constraint = agent_account.operator == operator.key() @ TaskMarketError::CallerNotOperator,
    )]
    pub agent_account: Account<'info, AgentAccount>,
}

pub fn handler(
    ctx: Context<SubmitResult>,
    result_hash: [u8; 32],
    proof_key: [u8; 32],
) -> Result<()> {
    let t = &mut ctx.accounts.task;
    require!(t.status == TaskStatus::Funded, TaskMarketError::WrongStatus);
    require!(result_hash != [0u8; 32], TaskMarketError::ZeroResultHash);

    let now = Clock::get()?.unix_timestamp;
    require!(now <= t.deadline, TaskMarketError::DeadlinePassed);

    require!(
        ctx.accounts.agent_account.status == AgentStatus::Active,
        TaskMarketError::AgentNotActive,
    );

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
    Ok(())
}
