use anchor_lang::prelude::*;
use anchor_spl::token_2022::{transfer_checked, Token2022, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount};
use capability_registry::state::RegistryConfig as CapabilityConfig;

use crate::errors::AgentRegistryError;
use crate::events::AgentRegistered;
use crate::state::{
    capability_check, compute_did, validate_manifest_uri, AgentAccount, AgentStatus,
    RegistryGlobal, ReputationScore, MANIFEST_URI_LEN,
};

#[derive(Accounts)]
#[instruction(agent_id: [u8; 32])]
pub struct RegisterAgent<'info> {
    #[account(
        seeds = [b"global"],
        bump = global.bump,
    )]
    pub global: Box<Account<'info, RegistryGlobal>>,

    #[account(
        seeds = [b"config"],
        seeds::program = global.capability_registry,
        bump = capability_config.bump,
    )]
    pub capability_config: Box<Account<'info, CapabilityConfig>>,

    #[account(
        init,
        payer = operator,
        space = 8 + AgentAccount::INIT_SPACE,
        seeds = [b"agent", operator.key().as_ref(), agent_id.as_ref()],
        bump,
    )]
    pub agent: Box<Account<'info, AgentAccount>>,

    #[account(address = global.stake_mint)]
    pub stake_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = operator,
        token::mint = stake_mint,
        token::authority = stake_vault,
        token::token_program = token_program,
        seeds = [b"stake", agent.key().as_ref()],
        bump,
    )]
    pub stake_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = stake_mint,
        token::authority = operator,
        token::token_program = token_program,
    )]
    pub operator_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub operator: Signer<'info>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<RegisterAgent>,
    agent_id: [u8; 32],
    manifest_uri: [u8; MANIFEST_URI_LEN],
    capability_mask: u128,
    price_lamports: u64,
    stream_rate: u64,
    stake_amount: u64,
) -> Result<()> {
    let g = &ctx.accounts.global;
    require!(!g.paused, AgentRegistryError::Paused);
    require!(stake_amount >= g.min_stake, AgentRegistryError::StakeBelowMinimum);
    validate_manifest_uri(&manifest_uri)?;
    capability_check(ctx.accounts.capability_config.approved_mask, capability_mask)?;

    let now = Clock::get()?.unix_timestamp;
    let did = compute_did(&ctx.accounts.operator.key(), &agent_id, &manifest_uri);

    let agent = &mut ctx.accounts.agent;
    agent.operator = ctx.accounts.operator.key();
    agent.agent_id = agent_id;
    agent.did = did;
    agent.manifest_uri = manifest_uri;
    agent.capability_mask = capability_mask;
    agent.price_lamports = price_lamports;
    agent.stream_rate = stream_rate;
    agent.reputation = ReputationScore {
        ewma_alpha_bps: 2_000,
        ..Default::default()
    };
    agent.jobs_completed = 0;
    agent.jobs_disputed = 0;
    agent.stake_amount = stake_amount;
    agent.status = AgentStatus::Active;
    agent.version = 1;
    agent.registered_at = now;
    agent.last_active = now;
    agent.delegate = None;
    agent.pending_slash = None;
    agent.pending_withdrawal = None;
    agent.bump = ctx.bumps.agent;
    agent.vault_bump = ctx.bumps.stake_vault;

    let decimals = ctx.accounts.stake_mint.decimals;
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.operator_token_account.to_account_info(),
        mint: ctx.accounts.stake_mint.to_account_info(),
        to: ctx.accounts.stake_vault.to_account_info(),
        authority: ctx.accounts.operator.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    transfer_checked(cpi_ctx, stake_amount, decimals)?;

    emit!(AgentRegistered {
        agent_did: did,
        operator: ctx.accounts.operator.key(),
        capability_mask,
        stake_amount,
        timestamp: now,
    });
    Ok(())
}
