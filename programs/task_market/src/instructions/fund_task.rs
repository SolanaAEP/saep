use anchor_lang::prelude::*;
use anchor_spl::token_2022::{transfer_checked, Token2022, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::errors::TaskMarketError;
use crate::events::TaskFunded;
use crate::state::{MarketGlobal, TaskContract, TaskStatus};

#[derive(Accounts)]
pub struct FundTask<'info> {
    #[account(seeds = [b"market_global"], bump = global.bump)]
    pub global: Account<'info, MarketGlobal>,

    #[account(
        mut,
        seeds = [b"task", task.client.as_ref(), task.task_nonce.as_ref()],
        bump = task.bump,
        has_one = client @ TaskMarketError::Unauthorized,
    )]
    pub task: Account<'info, TaskContract>,

    #[account(address = task.payment_mint)]
    pub payment_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = client,
        seeds = [b"task_escrow", task.key().as_ref()],
        bump,
        token::mint = payment_mint,
        token::authority = escrow,
    )]
    pub escrow: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, token::mint = payment_mint, token::authority = client)]
    pub client_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub client: Signer<'info>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<FundTask>) -> Result<()> {
    require!(!ctx.accounts.global.paused, TaskMarketError::Paused);
    require!(
        ctx.accounts.task.status == TaskStatus::Created,
        TaskMarketError::WrongStatus
    );

    let amount = ctx.accounts.task.payment_amount;
    let decimals = ctx.accounts.payment_mint.decimals;

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.client_token_account.to_account_info(),
        mint: ctx.accounts.payment_mint.to_account_info(),
        to: ctx.accounts.escrow.to_account_info(),
        authority: ctx.accounts.client.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    transfer_checked(cpi_ctx, amount, decimals)?;

    let now = Clock::get()?.unix_timestamp;
    let t = &mut ctx.accounts.task;
    t.status = TaskStatus::Funded;
    t.funded_at = now;
    t.escrow_bump = ctx.bumps.escrow;

    emit!(TaskFunded {
        task_id: t.task_id,
        amount,
        timestamp: now,
    });
    Ok(())
}
