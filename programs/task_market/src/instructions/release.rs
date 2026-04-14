use anchor_lang::prelude::*;
use anchor_spl::token_2022::{transfer_checked, Token2022, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::cpi_stubs::{call_record_job_outcome, JobOutcome};
use crate::errors::TaskMarketError;
use crate::events::TaskReleased;
use crate::state::{MarketGlobal, TaskContract, TaskStatus};

#[derive(Accounts)]
pub struct Release<'info> {
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

    #[account(mut, token::mint = payment_mint)]
    pub agent_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, token::mint = payment_mint)]
    pub fee_collector_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, token::mint = payment_mint)]
    pub solrep_pool_token_account: InterfaceAccount<'info, TokenAccount>,

    pub cranker: Signer<'info>,
    pub token_program: Program<'info, Token2022>,
}

pub fn handler(ctx: Context<Release>) -> Result<()> {
    require!(!ctx.accounts.global.paused, TaskMarketError::Paused);

    let now = Clock::get()?.unix_timestamp;
    let t_ref = &ctx.accounts.task;
    require!(t_ref.status == TaskStatus::Verified, TaskMarketError::WrongStatus);
    require!(
        now >= t_ref.dispute_window_end,
        TaskMarketError::DisputeWindowOpen
    );

    let payment_amount = t_ref.payment_amount;
    let protocol_fee = t_ref.protocol_fee;
    let solrep_fee = t_ref.solrep_fee;
    let agent_payout = payment_amount
        .checked_sub(protocol_fee)
        .and_then(|v| v.checked_sub(solrep_fee))
        .ok_or(TaskMarketError::ArithmeticOverflow)?;

    // State-before-CPI: write terminal status before any fund movement.
    let task_key = ctx.accounts.task.key();
    let agent_did = ctx.accounts.task.agent_did;
    let task_id = ctx.accounts.task.task_id;
    let escrow_bump = ctx.accounts.task.escrow_bump;
    {
        let t = &mut ctx.accounts.task;
        t.status = TaskStatus::Released;
    }

    let decimals = ctx.accounts.payment_mint.decimals;
    let seeds: &[&[u8]] = &[
        b"task_escrow",
        task_key.as_ref(),
        core::slice::from_ref(&escrow_bump),
    ];
    let signer = &[seeds];

    if agent_payout > 0 {
        let cpi = TransferChecked {
            from: ctx.accounts.escrow.to_account_info(),
            mint: ctx.accounts.payment_mint.to_account_info(),
            to: ctx.accounts.agent_token_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        let ctx_cpi = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi,
            signer,
        );
        transfer_checked(ctx_cpi, agent_payout, decimals)?;
    }

    if protocol_fee > 0 {
        let cpi = TransferChecked {
            from: ctx.accounts.escrow.to_account_info(),
            mint: ctx.accounts.payment_mint.to_account_info(),
            to: ctx.accounts.fee_collector_token_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        let ctx_cpi = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi,
            signer,
        );
        transfer_checked(ctx_cpi, protocol_fee, decimals)?;
    }

    if solrep_fee > 0 {
        let cpi = TransferChecked {
            from: ctx.accounts.escrow.to_account_info(),
            mint: ctx.accounts.payment_mint.to_account_info(),
            to: ctx.accounts.solrep_pool_token_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        let ctx_cpi = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi,
            signer,
        );
        transfer_checked(ctx_cpi, solrep_fee, decimals)?;
    }

    call_record_job_outcome(
        &ctx.accounts.global.agent_registry,
        &agent_did,
        JobOutcome {
            success: true,
            disputed: false,
        },
    )?;

    emit!(TaskReleased {
        task_id,
        agent_payout,
        protocol_fee,
        solrep_fee,
        timestamp: now,
    });
    Ok(())
}
