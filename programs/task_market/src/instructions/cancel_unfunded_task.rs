use anchor_lang::prelude::*;

use crate::errors::TaskMarketError;
use crate::events::TaskCancelled;
use crate::state::{TaskContract, TaskStatus, CANCEL_GRACE_SECS};

#[derive(Accounts)]
pub struct CancelUnfundedTask<'info> {
    #[account(
        mut,
        close = client,
        seeds = [b"task", task.client.as_ref(), task.task_nonce.as_ref()],
        bump = task.bump,
        has_one = client @ TaskMarketError::Unauthorized,
    )]
    pub task: Account<'info, TaskContract>,

    #[account(mut)]
    pub client: Signer<'info>,
}

pub fn handler(ctx: Context<CancelUnfundedTask>) -> Result<()> {
    let t = &ctx.accounts.task;
    require!(t.status == TaskStatus::Created, TaskMarketError::WrongStatus);

    let now = Clock::get()?.unix_timestamp;
    let unlock_at = t
        .created_at
        .checked_add(CANCEL_GRACE_SECS)
        .ok_or(TaskMarketError::ArithmeticOverflow)?;
    require!(now >= unlock_at, TaskMarketError::GraceNotElapsed);

    emit!(TaskCancelled {
        task_id: t.task_id,
        timestamp: now,
    });
    Ok(())
}
