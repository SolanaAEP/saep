use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, TokenInterface, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::errors::AgentRegistryError;
use crate::events::{GuardEntered, StakeIncreased, WithdrawalExecuted, WithdrawalRequested};
use crate::guard::{exit as guard_exit, try_enter, ReentrancyGuard, SEED_GUARD};
use crate::state::{AgentAccount, AgentStatus, PendingWithdrawal, RegistryGlobal};

#[derive(Accounts)]
pub struct StakeIncrease<'info> {
    #[account(seeds = [b"global"], bump = global.bump)]
    pub global: Box<Account<'info, RegistryGlobal>>,

    #[account(
        mut,
        seeds = [b"agent", agent.operator.as_ref(), agent.agent_id.as_ref()],
        bump = agent.bump,
        has_one = operator @ AgentRegistryError::Unauthorized,
    )]
    pub agent: Box<Account<'info, AgentAccount>>,

    #[account(address = global.stake_mint)]
    pub stake_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"stake", agent.key().as_ref()],
        bump = agent.vault_bump,
        token::mint = stake_mint,
    )]
    pub stake_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, token::mint = stake_mint, token::authority = operator)]
    pub operator_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [SEED_GUARD], bump = guard.bump)]
    pub guard: Box<Account<'info, ReentrancyGuard>>,

    pub operator: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn stake_increase_handler(ctx: Context<StakeIncrease>, amount: u64) -> Result<()> {
    let clock = Clock::get()?;
    try_enter(&mut ctx.accounts.guard, crate::ID, clock.slot)?;
    emit!(GuardEntered {
        program: crate::ID,
        caller: crate::ID,
        slot: clock.slot,
        stack_height: 1,
    });

    require!(!ctx.accounts.global.paused, AgentRegistryError::Paused);
    require!(amount > 0, AgentRegistryError::ArithmeticOverflow);

    let agent = &mut ctx.accounts.agent;
    agent.stake_amount = agent
        .stake_amount
        .checked_add(amount)
        .ok_or(AgentRegistryError::ArithmeticOverflow)?;

    let decimals = ctx.accounts.stake_mint.decimals;
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.operator_token_account.to_account_info(),
        mint: ctx.accounts.stake_mint.to_account_info(),
        to: ctx.accounts.stake_vault.to_account_info(),
        authority: ctx.accounts.operator.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    transfer_checked(cpi_ctx, amount, decimals)?;

    emit!(StakeIncreased {
        agent_did: agent.did,
        amount,
        new_total: agent.stake_amount,
        timestamp: clock.unix_timestamp,
    });

    guard_exit(&mut ctx.accounts.guard);
    Ok(())
}

#[derive(Accounts)]
pub struct StakeWithdrawRequest<'info> {
    #[account(seeds = [b"global"], bump = global.bump)]
    pub global: Account<'info, RegistryGlobal>,

    #[account(
        mut,
        seeds = [b"agent", agent.operator.as_ref(), agent.agent_id.as_ref()],
        bump = agent.bump,
        has_one = operator @ AgentRegistryError::Unauthorized,
    )]
    pub agent: Account<'info, AgentAccount>,

    pub operator: Signer<'info>,
}

pub fn stake_withdraw_request_handler(
    ctx: Context<StakeWithdrawRequest>,
    amount: u64,
) -> Result<()> {
    require!(!ctx.accounts.global.paused, AgentRegistryError::Paused);
    let g = &ctx.accounts.global;
    let agent = &mut ctx.accounts.agent;
    require!(agent.pending_withdrawal.is_none(), AgentRegistryError::WithdrawalPending);
    require!(agent.pending_slash.is_none(), AgentRegistryError::SlashPending);
    require!(amount > 0 && amount <= agent.stake_amount, AgentRegistryError::ArithmeticOverflow);

    let now = Clock::get()?.unix_timestamp;
    let executable_at = now
        .checked_add(g.slash_timelock_secs)
        .ok_or(AgentRegistryError::ArithmeticOverflow)?;

    agent.pending_withdrawal = Some(PendingWithdrawal {
        amount,
        requested_at: now,
        executable_at,
    });

    emit!(WithdrawalRequested {
        agent_did: agent.did,
        amount,
        executable_at,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct StakeWithdrawExecute<'info> {
    #[account(seeds = [b"global"], bump = global.bump)]
    pub global: Box<Account<'info, RegistryGlobal>>,

    #[account(
        mut,
        seeds = [b"agent", agent.operator.as_ref(), agent.agent_id.as_ref()],
        bump = agent.bump,
        has_one = operator @ AgentRegistryError::Unauthorized,
    )]
    pub agent: Box<Account<'info, AgentAccount>>,

    #[account(address = global.stake_mint)]
    pub stake_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"stake", agent.key().as_ref()],
        bump = agent.vault_bump,
        token::mint = stake_mint,
    )]
    pub stake_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, token::mint = stake_mint, token::authority = operator)]
    pub operator_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [SEED_GUARD], bump = guard.bump)]
    pub guard: Box<Account<'info, ReentrancyGuard>>,

    pub operator: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn stake_withdraw_execute_handler(ctx: Context<StakeWithdrawExecute>) -> Result<()> {
    let clock = Clock::get()?;
    try_enter(&mut ctx.accounts.guard, crate::ID, clock.slot)?;
    emit!(GuardEntered {
        program: crate::ID,
        caller: crate::ID,
        slot: clock.slot,
        stack_height: 1,
    });

    require!(!ctx.accounts.global.paused, AgentRegistryError::Paused);

    let now = clock.unix_timestamp;
    let agent_key = ctx.accounts.agent.key();
    let agent = &mut ctx.accounts.agent;
    require!(agent.pending_slash.is_none(), AgentRegistryError::SlashPending);
    let w = agent.pending_withdrawal.ok_or(AgentRegistryError::NoPendingWithdrawal)?;
    require!(now >= w.executable_at, AgentRegistryError::TimelockNotElapsed);
    require!(w.amount <= agent.stake_amount, AgentRegistryError::ArithmeticOverflow);

    agent.stake_amount = agent
        .stake_amount
        .checked_sub(w.amount)
        .ok_or(AgentRegistryError::ArithmeticOverflow)?;
    agent.pending_withdrawal = None;
    if agent.stake_amount < ctx.accounts.global.min_stake {
        agent.status = AgentStatus::Deregistered;
    }

    let decimals = ctx.accounts.stake_mint.decimals;
    let vault_bump = agent.vault_bump;
    let did = agent.did;

    let seeds: &[&[u8]] = &[b"stake", agent_key.as_ref(), &[vault_bump]];
    let signer = &[seeds];

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.stake_vault.to_account_info(),
        mint: ctx.accounts.stake_mint.to_account_info(),
        to: ctx.accounts.operator_token_account.to_account_info(),
        authority: ctx.accounts.stake_vault.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        signer,
    );
    transfer_checked(cpi_ctx, w.amount, decimals)?;

    emit!(WithdrawalExecuted {
        agent_did: did,
        amount: w.amount,
        timestamp: now,
    });

    guard_exit(&mut ctx.accounts.guard);
    Ok(())
}
