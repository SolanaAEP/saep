use anchor_lang::prelude::*;

use crate::errors::FeeCollectorError;
use crate::events::AgentHookAllowlistUpdated;
use crate::state::{
    AgentHookAllowlist, HookAllowlist, MAX_AGENT_HOOK_PROGRAMS, SEED_AGENT_HOOKS,
    SEED_HOOK_ALLOWLIST,
};

#[derive(Accounts)]
#[instruction(agent_did: [u8; 32])]
pub struct InitAgentHookAllowlist<'info> {
    #[account(
        seeds = [SEED_HOOK_ALLOWLIST],
        bump = global.bump,
        has_one = authority @ FeeCollectorError::Unauthorized,
    )]
    pub global: Account<'info, HookAllowlist>,

    #[account(
        init,
        payer = payer,
        space = 8 + AgentHookAllowlist::INIT_SPACE,
        seeds = [SEED_AGENT_HOOKS, agent_did.as_ref()],
        bump,
    )]
    pub agent: Account<'info, AgentHookAllowlist>,

    pub authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn init_agent_handler(
    ctx: Context<InitAgentHookAllowlist>,
    agent_did: [u8; 32],
) -> Result<()> {
    let a = &mut ctx.accounts.agent;
    a.agent_did = agent_did;
    a.extra_programs = Vec::with_capacity(MAX_AGENT_HOOK_PROGRAMS);
    a.bump = ctx.bumps.agent;

    emit!(AgentHookAllowlistUpdated {
        agent_did,
        added: vec![],
        removed: vec![],
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateAgentHookAllowlist<'info> {
    #[account(
        seeds = [SEED_HOOK_ALLOWLIST],
        bump = global.bump,
        has_one = authority @ FeeCollectorError::Unauthorized,
    )]
    pub global: Account<'info, HookAllowlist>,

    #[account(
        mut,
        seeds = [SEED_AGENT_HOOKS, agent.agent_did.as_ref()],
        bump = agent.bump,
    )]
    pub agent: Account<'info, AgentHookAllowlist>,

    pub authority: Signer<'info>,
}

pub fn update_agent_handler(
    ctx: Context<UpdateAgentHookAllowlist>,
    add: Vec<Pubkey>,
    remove: Vec<Pubkey>,
) -> Result<()> {
    let a = &mut ctx.accounts.agent;

    for r in &remove {
        a.extra_programs.retain(|p| p != r);
    }
    for p in &add {
        require!(*p != Pubkey::default(), FeeCollectorError::InvalidProgramId);
        if !a.extra_programs.iter().any(|e| e == p) {
            a.extra_programs.push(*p);
        }
    }
    require!(
        a.extra_programs.len() <= MAX_AGENT_HOOK_PROGRAMS,
        FeeCollectorError::AgentHookAllowlistFull
    );

    emit!(AgentHookAllowlistUpdated {
        agent_did: a.agent_did,
        added: add,
        removed: remove,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
