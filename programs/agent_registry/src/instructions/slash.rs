use anchor_lang::prelude::*;
use anchor_spl::token_2022::{transfer_checked, Token2022, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::errors::AgentRegistryError;
use crate::events::{SlashCancelled, SlashExecuted, SlashProposed};
use crate::state::{assert_slash_bound, AgentAccount, AgentStatus, PendingSlash, RegistryGlobal};

#[derive(Accounts)]
pub struct ProposeSlash<'info> {
    #[account(
        seeds = [b"global"],
        bump = global.bump,
        has_one = authority @ AgentRegistryError::Unauthorized,
    )]
    pub global: Account<'info, RegistryGlobal>,

    #[account(
        mut,
        seeds = [b"agent", agent.operator.as_ref(), agent.agent_id.as_ref()],
        bump = agent.bump,
    )]
    pub agent: Account<'info, AgentAccount>,

    pub authority: Signer<'info>,
}

pub fn propose_slash_handler(
    ctx: Context<ProposeSlash>,
    amount: u64,
    reason_code: u16,
) -> Result<()> {
    let g = &ctx.accounts.global;
    let agent = &mut ctx.accounts.agent;
    require!(agent.pending_slash.is_none(), AgentRegistryError::SlashPending);
    assert_slash_bound(amount, agent.stake_amount, g.max_slash_bps)?;

    let now = Clock::get()?.unix_timestamp;
    let executable_at = now
        .checked_add(g.slash_timelock_secs)
        .ok_or(AgentRegistryError::ArithmeticOverflow)?;

    agent.pending_slash = Some(PendingSlash {
        amount,
        reason_code,
        proposed_at: now,
        executable_at,
        proposer: ctx.accounts.authority.key(),
        appeal_pending: false,
    });

    emit!(SlashProposed {
        agent_did: agent.did,
        amount,
        reason_code,
        executable_at,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CancelSlash<'info> {
    #[account(
        seeds = [b"global"],
        bump = global.bump,
        has_one = authority @ AgentRegistryError::Unauthorized,
    )]
    pub global: Account<'info, RegistryGlobal>,

    #[account(
        mut,
        seeds = [b"agent", agent.operator.as_ref(), agent.agent_id.as_ref()],
        bump = agent.bump,
    )]
    pub agent: Account<'info, AgentAccount>,

    pub authority: Signer<'info>,
}

pub fn cancel_slash_handler(ctx: Context<CancelSlash>) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    require!(agent.pending_slash.is_some(), AgentRegistryError::NoPendingSlash);
    agent.pending_slash = None;
    emit!(SlashCancelled {
        agent_did: agent.did,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteSlash<'info> {
    #[account(seeds = [b"global"], bump = global.bump)]
    pub global: Account<'info, RegistryGlobal>,

    #[account(
        mut,
        seeds = [b"agent", agent.operator.as_ref(), agent.agent_id.as_ref()],
        bump = agent.bump,
    )]
    pub agent: Account<'info, AgentAccount>,

    #[account(address = global.stake_mint)]
    pub stake_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"stake", agent.key().as_ref()],
        bump = agent.vault_bump,
        token::mint = stake_mint,
    )]
    pub stake_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        address = global.slashing_treasury,
        token::mint = stake_mint,
    )]
    pub slashing_treasury: InterfaceAccount<'info, TokenAccount>,

    pub cranker: Signer<'info>,
    pub token_program: Program<'info, Token2022>,
}

pub fn execute_slash_handler(ctx: Context<ExecuteSlash>) -> Result<()> {
    require!(!ctx.accounts.global.paused, AgentRegistryError::Paused);

    let now = Clock::get()?.unix_timestamp;
    let agent_key = ctx.accounts.agent.key();
    let agent = &mut ctx.accounts.agent;
    let pending = agent.pending_slash.ok_or(AgentRegistryError::NoPendingSlash)?;
    require!(!pending.appeal_pending, AgentRegistryError::SlashPending);
    require!(now >= pending.executable_at, AgentRegistryError::TimelockNotElapsed);
    require!(pending.amount <= agent.stake_amount, AgentRegistryError::ArithmeticOverflow);

    agent.stake_amount = agent
        .stake_amount
        .checked_sub(pending.amount)
        .ok_or(AgentRegistryError::ArithmeticOverflow)?;
    agent.pending_slash = None;
    if agent.stake_amount < ctx.accounts.global.min_stake {
        agent.status = AgentStatus::Suspended;
    }

    let decimals = ctx.accounts.stake_mint.decimals;
    let vault_bump = agent.vault_bump;
    let did = agent.did;
    let amount = pending.amount;

    let seeds: &[&[u8]] = &[b"stake", agent_key.as_ref(), &[vault_bump]];
    let signer = &[seeds];

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.stake_vault.to_account_info(),
        mint: ctx.accounts.stake_mint.to_account_info(),
        to: ctx.accounts.slashing_treasury.to_account_info(),
        authority: ctx.accounts.stake_vault.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        signer,
    );
    transfer_checked(cpi_ctx, amount, decimals)?;

    emit!(SlashExecuted {
        agent_did: did,
        amount,
        timestamp: now,
    });
    Ok(())
}
