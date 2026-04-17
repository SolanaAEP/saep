use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, TokenInterface, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount};

use agent_registry::program::AgentRegistry;
use agent_registry::state::{AgentAccount, RegistryGlobal};

use fee_collector::{assert_hook_allowed_at_site, HookAllowlist, SITE_RELEASE};

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

    // F-2026-05: did-equality check moved into the handler so that a
    // commit-reveal winner (whose DID can differ from `task.agent_did`) is not
    // struct-rejected before the handler gets a chance to validate against
    // `task.assigned_agent`.
    // F-2026-03: no longer `mut` — reputation mutation rail removed.
    #[account(
        seeds = [b"agent", agent_account.operator.as_ref(), agent_account.agent_id.as_ref()],
        bump = agent_account.bump,
        seeds::program = agent_registry_program.key(),
    )]
    pub agent_account: Box<Account<'info, AgentAccount>>,

    /// CHECK: must be this program's own executable for CPI identity proof
    #[account(address = crate::ID)]
    pub self_program: UncheckedAccount<'info>,

    pub hook_allowlist: Option<Account<'info, HookAllowlist>>,

    #[account(mut, seeds = [SEED_GUARD], bump = guard.bump)]
    pub guard: Box<Account<'info, ReentrancyGuard>>,

    pub cranker: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
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

    // F-2026-05: when a bid book is in play, the winning agent (possibly
    // different from the client's originally-declared agent_did) must match
    // `task.assigned_agent`. Otherwise fall back to the did constraint.
    if t_ref.bid_book.is_some() {
        require!(
            t_ref.assigned_agent == Some(ctx.accounts.agent_account.key()),
            TaskMarketError::AgentMismatch,
        );
    } else {
        require!(
            ctx.accounts.agent_account.did == t_ref.agent_did,
            TaskMarketError::AgentMismatch,
        );
    }

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

    // Reputation is not mutated at release time. The proof_verifier drives
    // per-capability PDA updates via agent_registry::update_reputation.
    // AgentAccount.reputation is a read-only historical summary field.

    emit!(TaskReleased {
        task_id,
        agent_did: ctx.accounts.agent_account.agent_id,
        operator: ctx.accounts.agent_account.operator,
        client: ctx.accounts.task.client,
        mint: ctx.accounts.payment_mint.key(),
        agent_payout,
        protocol_fee,
        solrep_fee,
        timestamp: now,
    });

    guard_exit(&mut ctx.accounts.guard);
    Ok(())
}
