use anchor_lang::prelude::*;
use anchor_spl::token_2022::{transfer_checked, Token2022, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount};

use agent_registry::program::AgentRegistry;
use agent_registry::state::{AgentAccount, RegistryGlobal};

use fee_collector::{assert_hook_allowed_at_site, HookAllowlist, SITE_EXPIRE};

use crate::cpi_stubs::{call_record_job_outcome, JobOutcome};
use crate::errors::TaskMarketError;
use crate::events::{GuardEntered, TaskExpired};
use crate::guard::{exit as guard_exit, try_enter, ReentrancyGuard, SEED_GUARD};
use crate::state::{resolve_hook_allowlist, MarketGlobal, TaskContract, TaskStatus, EXPIRE_GRACE_SECS};

#[derive(Accounts)]
pub struct Expire<'info> {
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

    /// CHECK: matched against task.client via has_one-style constraint on task.
    #[account(address = task.client)]
    pub client: UncheckedAccount<'info>,

    #[account(
        constraint = agent_registry_program.key() == global.agent_registry @ TaskMarketError::Unauthorized,
    )]
    pub agent_registry_program: Program<'info, AgentRegistry>,

    #[account(
        seeds = [b"global"],
        bump = registry_global.bump,
        seeds::program = agent_registry_program.key(),
    )]
    pub registry_global: Box<Account<'info, RegistryGlobal>>,

    #[account(
        mut,
        seeds = [b"agent", agent_account.operator.as_ref(), agent_account.agent_id.as_ref()],
        bump = agent_account.bump,
        seeds::program = agent_registry_program.key(),
        constraint = agent_account.did == task.agent_did @ TaskMarketError::AgentMismatch,
    )]
    pub agent_account: Box<Account<'info, AgentAccount>>,

    /// CHECK: must be this program's own executable for CPI identity proof
    #[account(address = crate::ID)]
    pub self_program: UncheckedAccount<'info>,

    pub hook_allowlist: Option<Account<'info, HookAllowlist>>,

    #[account(mut, seeds = [SEED_GUARD], bump = guard.bump)]
    pub guard: Box<Account<'info, ReentrancyGuard>>,

    pub cranker: Signer<'info>,
    pub token_program: Program<'info, Token2022>,
}

pub fn handler(ctx: Context<Expire>) -> Result<()> {
    let clock = Clock::get()?;
    try_enter(&mut ctx.accounts.guard, crate::ID, clock.slot)?;
    emit!(GuardEntered {
        program: crate::ID,
        caller: crate::ID,
        slot: clock.slot,
        stack_height: 1,
    });

    let t_ref = &ctx.accounts.task;
    let status = t_ref.status;
    require!(
        matches!(status, TaskStatus::Funded | TaskStatus::ProofSubmitted),
        TaskMarketError::WrongStatus
    );

    let now = clock.unix_timestamp;
    let expire_at = t_ref
        .deadline
        .checked_add(EXPIRE_GRACE_SECS)
        .ok_or(TaskMarketError::ArithmeticOverflow)?;
    require!(now > expire_at, TaskMarketError::NotExpired);

    let task_key = ctx.accounts.task.key();
    let task_id = t_ref.task_id;
    let refund_amount = t_ref.payment_amount;
    let escrow_bump = t_ref.escrow_bump;
    let market_global_bump = ctx.accounts.global.bump;

    // State-before-CPI: set terminal status prior to moving funds or CPI.
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

    call_record_job_outcome(
        &ctx.accounts.agent_registry_program.key(),
        ctx.accounts.registry_global.to_account_info(),
        ctx.accounts.agent_account.to_account_info(),
        ctx.accounts.self_program.to_account_info(),
        ctx.accounts.global.to_account_info(),
        market_global_bump,
        JobOutcome {
            success: false,
            quality_bps: 0,
            timeliness_bps: 0,
            cost_efficiency_bps: 0,
            disputed: false,
        },
    )?;

    emit!(TaskExpired {
        task_id,
        refund_amount,
        timestamp: now,
    });

    guard_exit(&mut ctx.accounts.guard);
    Ok(())
}
