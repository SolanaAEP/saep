use anchor_lang::prelude::*;

use crate::errors::TaskMarketError;
use crate::events::ResultSubmitted;
use crate::state::{read_agent_operator_match, MarketGlobal, TaskContract, TaskStatus};

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

    read_agent_operator_match(
        &ctx.accounts.global.agent_registry,
        &t.agent_did,
        &ctx.accounts.operator.key(),
    )?;

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
