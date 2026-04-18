use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, TokenInterface, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount};

use fee_collector::{assert_hook_allowed_at_site, HookAllowlist, SITE_EXPIRE};

use crate::errors::TaskMarketError;
use crate::events::{GuardEntered, TaskExpired};
use crate::guard::{exit as guard_exit, try_enter, ReentrancyGuard, SEED_GUARD};
use crate::state::{resolve_hook_allowlist, MarketGlobal, TaskContract, TaskStatus};

/// 72h after dispute_window_end, anyone may crank a refund to the client if
/// arbitration has not produced a resolution. Prevents funds from being locked
/// indefinitely when the dispute path stalls.
pub const DISPUTE_TIMEOUT_SECS: i64 = 3 * 24 * 60 * 60;

#[derive(Accounts)]
pub struct DisputedTimeoutRefund<'info> {
    #[account(seeds = [b"market_global"], bump = global.bump)]
    pub global: Box<Account<'info, MarketGlobal>>,

    #[account(
        mut,
        seeds = [b"task", task.client.as_ref(), task.task_nonce.as_ref()],
        bump = task.bump,
    )]
    pub task: Box<Account<'info, TaskContract>>,

    #[account(address = task.payment_mint)]
    pub payment_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [b"task_escrow", task.key().as_ref()],
        bump = task.escrow_bump,
        token::mint = payment_mint,
    )]
    pub escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = payment_mint, token::authority = client)]
    pub client_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: matched against task.client via address constraint.
    #[account(address = task.client)]
    pub client: UncheckedAccount<'info>,

    pub hook_allowlist: Option<Account<'info, HookAllowlist>>,

    #[account(mut, seeds = [SEED_GUARD], bump = guard.bump)]
    pub guard: Box<Account<'info, ReentrancyGuard>>,

    pub cranker: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<DisputedTimeoutRefund>) -> Result<()> {
    let clock = Clock::get()?;
    try_enter(&mut ctx.accounts.guard, crate::ID, clock.slot)?;
    emit!(GuardEntered {
        program: crate::ID,
        caller: crate::ID,
        slot: clock.slot,
        stack_height: 1,
    });

    let t_ref = &ctx.accounts.task;
    require!(t_ref.status == TaskStatus::Disputed, TaskMarketError::WrongStatus);

    let now = clock.unix_timestamp;
    let timeout_at = t_ref
        .dispute_window_end
        .checked_add(DISPUTE_TIMEOUT_SECS)
        .ok_or(TaskMarketError::ArithmeticOverflow)?;
    require!(now > timeout_at, TaskMarketError::NotExpired);

    let task_key = ctx.accounts.task.key();
    let task_id = t_ref.task_id;
    let refund_amount = t_ref.payment_amount;
    let escrow_bump = t_ref.escrow_bump;

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

    if let Some(g) = resolve_hook_allowlist(
        &ctx.accounts.global,
        ctx.accounts.hook_allowlist.as_ref(),
    )? {
        assert_hook_allowed_at_site(
            &ctx.accounts.payment_mint.to_account_info(),
            g,
            None,
            SITE_EXPIRE,
        )
        .map_err(|_| error!(TaskMarketError::HookNotAllowed))?;
    }

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

    emit!(TaskExpired {
        task_id,
        refund_amount,
        timestamp: now,
    });

    guard_exit(&mut ctx.accounts.guard);
    Ok(())
}
