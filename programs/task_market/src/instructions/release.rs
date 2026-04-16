use anchor_lang::prelude::*;
use anchor_spl::token_2022::{transfer_checked, Token2022, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount};

use agent_registry::program::AgentRegistry;
use agent_registry::state::{AgentAccount, RegistryGlobal};

use fee_collector::{assert_hook_allowed_at_site, HookAllowlist, SITE_RELEASE};

use crate::cpi_stubs::{call_record_job_outcome, JobOutcome};
use crate::errors::TaskMarketError;
use crate::events::{GuardEntered, TaskReleased};
use crate::guard::{exit as guard_exit, try_enter, ReentrancyGuard, SEED_GUARD};
use crate::state::{resolve_hook_allowlist, MarketGlobal, TaskContract, TaskStatus};

#[derive(Accounts)]
pub struct Release<'info> {
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

    #[account(mut, token::mint = payment_mint)]
    pub agent_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = payment_mint)]
    pub fee_collector_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = payment_mint)]
    pub solrep_pool_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

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

pub fn handler(ctx: Context<Release>) -> Result<()> {
    let clock = Clock::get()?;
    try_enter(&mut ctx.accounts.guard, crate::ID, clock.slot)?;
    emit!(GuardEntered {
        program: crate::ID,
        caller: crate::ID,
        slot: clock.slot,
        stack_height: 1,
    });

    require!(!ctx.accounts.global.paused, TaskMarketError::Paused);

    let now = clock.unix_timestamp;
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

    let task_key = ctx.accounts.task.key();
    let task_id = ctx.accounts.task.task_id;
    let escrow_bump = ctx.accounts.task.escrow_bump;
    let market_global_bump = ctx.accounts.global.bump;

    // State-before-CPI: write terminal status before any fund movement or CPI.
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

    if let Some(g) = resolve_hook_allowlist(
        &ctx.accounts.global,
        ctx.accounts.hook_allowlist.as_ref(),
    )? {
        assert_hook_allowed_at_site(
            &ctx.accounts.payment_mint.to_account_info(),
            g,
            None,
            SITE_RELEASE,
        )
        .map_err(|_| error!(TaskMarketError::HookNotAllowed))?;
    }

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
        &ctx.accounts.agent_registry_program.key(),
        ctx.accounts.registry_global.to_account_info(),
        ctx.accounts.agent_account.to_account_info(),
        ctx.accounts.self_program.to_account_info(),
        ctx.accounts.global.to_account_info(),
        market_global_bump,
        JobOutcome {
            success: true,
            quality_bps: 10_000,
            timeliness_bps: 10_000,
            cost_efficiency_bps: 10_000,
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

    guard_exit(&mut ctx.accounts.guard);
    Ok(())
}
