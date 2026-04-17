use anchor_lang::prelude::*;

use crate::errors::AgentRegistryError;
use crate::events::{DelegateSet, StatusChanged};
use crate::state::{AgentAccount, AgentStatus, RegistryGlobal};

#[derive(Accounts)]
pub struct DelegateControl<'info> {
    #[account(
        mut,
        seeds = [b"agent", agent.operator.as_ref(), agent.agent_id.as_ref()],
        bump = agent.bump,
        has_one = operator @ AgentRegistryError::Unauthorized,
    )]
    pub agent: Account<'info, AgentAccount>,
    pub operator: Signer<'info>,
}

pub fn delegate_control_handler(
    ctx: Context<DelegateControl>,
    delegate: Option<Pubkey>,
) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    agent.delegate = delegate;
    emit!(DelegateSet {
        agent_did: agent.did,
        delegate,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetStatus<'info> {
    #[account(seeds = [b"global"], bump = global.bump)]
    pub global: Account<'info, RegistryGlobal>,
    #[account(
        mut,
        seeds = [b"agent", agent.operator.as_ref(), agent.agent_id.as_ref()],
        bump = agent.bump,
    )]
    pub agent: Account<'info, AgentAccount>,
    pub signer: Signer<'info>,
}

pub fn set_status_handler(ctx: Context<SetStatus>, new_status: AgentStatus) -> Result<()> {
    require!(!ctx.accounts.global.paused, AgentRegistryError::Paused);
    let agent = &mut ctx.accounts.agent;
    let signer = ctx.accounts.signer.key();
    let is_operator = signer == agent.operator;
    let is_delegate = agent.delegate.map(|d| d == signer).unwrap_or(false);

    match (agent.status, new_status) {
        (AgentStatus::Active, AgentStatus::Paused) | (AgentStatus::Paused, AgentStatus::Active) => {
            require!(is_operator || is_delegate, AgentRegistryError::Unauthorized);
        }
        (_, AgentStatus::Deregistered) => {
            require!(is_operator, AgentRegistryError::Unauthorized);
            require!(
                !matches!(agent.status, AgentStatus::Deregistered),
                AgentRegistryError::InvalidStatusTransition
            );
        }
        _ => return err!(AgentRegistryError::InvalidStatusTransition),
    }

    agent.status = new_status;
    emit!(StatusChanged {
        agent_did: agent.did,
        new_status: new_status as u8,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
