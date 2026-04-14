use anchor_lang::prelude::*;

use crate::cpi_stubs::call_proof_verifier;
use crate::errors::TaskMarketError;
use crate::events::{TaskVerified, VerificationFailed};
use crate::state::{MarketGlobal, TaskContract, TaskStatus};

#[derive(Accounts)]
pub struct VerifyTask<'info> {
    #[account(seeds = [b"market_global"], bump = global.bump)]
    pub global: Account<'info, MarketGlobal>,

    #[account(
        mut,
        seeds = [b"task", task.client.as_ref(), task.task_nonce.as_ref()],
        bump = task.bump,
    )]
    pub task: Account<'info, TaskContract>,

    pub cranker: Signer<'info>,
}

pub fn handler(
    ctx: Context<VerifyTask>,
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
) -> Result<()> {
    let t = &mut ctx.accounts.task;
    require!(
        t.status == TaskStatus::ProofSubmitted,
        TaskMarketError::WrongStatus
    );

    let now = Clock::get()?.unix_timestamp;
    let res = call_proof_verifier(
        &ctx.accounts.global.proof_verifier,
        t.task_hash,
        t.result_hash,
        t.deadline,
        t.submitted_at,
        t.criteria_root,
        proof_a,
        proof_b,
        proof_c,
    );

    if res.is_err() {
        emit!(VerificationFailed {
            task_id: t.task_id,
            timestamp: now,
        });
        return err!(TaskMarketError::ProofInvalid);
    }

    let dispute_window_end = t
        .deadline
        .checked_add(ctx.accounts.global.dispute_window_secs)
        .ok_or(TaskMarketError::ArithmeticOverflow)?;

    t.status = TaskStatus::Verified;
    t.verified = true;
    t.dispute_window_end = dispute_window_end;

    emit!(TaskVerified {
        task_id: t.task_id,
        dispute_window_end,
        timestamp: now,
    });
    Ok(())
}
