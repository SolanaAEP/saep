use anchor_lang::prelude::*;

use crate::errors::TaskMarketError;
use crate::events::DisputeRaised;
use crate::state::{TaskContract, TaskStatus};

#[derive(Accounts)]
pub struct RaiseDispute<'info> {
    #[account(
        mut,
        seeds = [b"task", task.client.as_ref(), task.task_nonce.as_ref()],
        bump = task.bump,
        has_one = client @ TaskMarketError::Unauthorized,
    )]
    pub task: Account<'info, TaskContract>,

    pub client: Signer<'info>,
}

pub fn handler(ctx: Context<RaiseDispute>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let t = &mut ctx.accounts.task;
    require!(t.status == TaskStatus::Verified, TaskMarketError::WrongStatus);
    require!(now < t.dispute_window_end, TaskMarketError::DisputeWindowClosed);

    t.status = TaskStatus::Disputed;

    emit!(DisputeRaised {
        task_id: t.task_id,
        client: t.client,
        timestamp: now,
    });
    Ok(())
}
