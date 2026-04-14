use anchor_lang::prelude::*;
use anchor_spl::token_2022::{transfer_checked, Token2022, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::cpi_stubs::{call_record_job_outcome, JobOutcome};
use crate::errors::TaskMarketError;
use crate::events::TaskExpired;
use crate::state::{MarketGlobal, TaskContract, TaskStatus, EXPIRE_GRACE_SECS};

#[derive(Accounts)]
pub struct Expire<'info> {
    #[account(seeds = [b"market_global"], bump = global.bump)]
    pub global: Account<'info, MarketGlobal>,

    #[account(
        mut,
        seeds = [b"task", task.client.as_ref(), task.task_nonce.as_ref()],
        bump = task.bump,
    )]
    pub task: Account<'info, TaskContract>,

    #[account(address = task.payment_mint)]
    pub payment_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"task_escrow", task.key().as_ref()],
        bump = task.escrow_bump,
        token::mint = payment_mint,
    )]
    pub escrow: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, token::mint = payment_mint, token::authority = client)]
    pub client_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: matched against task.client via has_one-style constraint on task.
    #[account(address = task.client)]
    pub client: UncheckedAccount<'info>,

    pub cranker: Signer<'info>,
    pub token_program: Program<'info, Token2022>,
}

pub fn handler(ctx: Context<Expire>) -> Result<()> {
    let t_ref = &ctx.accounts.task;
    let status = t_ref.status;
    require!(
        matches!(status, TaskStatus::Funded | TaskStatus::ProofSubmitted),
        TaskMarketError::WrongStatus
    );

    let now = Clock::get()?.unix_timestamp;
    let expire_at = t_ref
        .deadline
        .checked_add(EXPIRE_GRACE_SECS)
        .ok_or(TaskMarketError::ArithmeticOverflow)?;
    require!(now > expire_at, TaskMarketError::NotExpired);

    let task_key = ctx.accounts.task.key();
    let task_id = t_ref.task_id;
    let agent_did = t_ref.agent_did;
    let refund_amount = t_ref.payment_amount;
    let escrow_bump = t_ref.escrow_bump;

    // State-before-CPI: set terminal status prior to moving funds.
    {
        let t = &mut ctx.accounts.task;
        t.status = TaskStatus::Expired;
    }

    let decimals = ctx.accounts.payment_mint.decimals;
    let seeds: &[&[u8]] = &[
        b"task_escrow",
        task_key.as_ref(),
        core::slice::from_ref(&escrow_bump),
    ];
    let signer = &[seeds];

    if refund_amount > 0 {
        let cpi = TransferChecked {
            from: ctx.accounts.escrow.to_account_info(),
            mint: ctx.accounts.payment_mint.to_account_info(),
            to: ctx.accounts.client_token_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        let ctx_cpi = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi,
            signer,
        );
        transfer_checked(ctx_cpi, refund_amount, decimals)?;
    }

    call_record_job_outcome(
        &ctx.accounts.global.agent_registry,
        &agent_did,
        JobOutcome {
            success: false,
            disputed: false,
        },
    )?;

    emit!(TaskExpired {
        task_id,
        refund_amount,
        timestamp: now,
    });
    Ok(())
}
