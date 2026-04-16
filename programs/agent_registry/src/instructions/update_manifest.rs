use anchor_lang::prelude::*;
use capability_registry::state::RegistryConfig as CapabilityConfig;

use crate::errors::AgentRegistryError;
use crate::events::ManifestUpdated;
use crate::state::{
    capability_check, validate_manifest_uri, AgentAccount, AgentStatus, RegistryGlobal,
    MANIFEST_URI_LEN,
};

#[derive(Accounts)]
pub struct UpdateManifest<'info> {
    #[account(seeds = [b"global"], bump = global.bump)]
    pub global: Box<Account<'info, RegistryGlobal>>,

    #[account(
        seeds = [b"config"],
        seeds::program = global.capability_registry,
        bump = capability_config.bump,
    )]
    pub capability_config: Box<Account<'info, CapabilityConfig>>,

    #[account(
        mut,
        seeds = [b"agent", agent.operator.as_ref(), agent.agent_id.as_ref()],
        bump = agent.bump,
        has_one = operator @ AgentRegistryError::Unauthorized,
    )]
    pub agent: Box<Account<'info, AgentAccount>>,

    pub operator: Signer<'info>,
}

pub fn handler(
    ctx: Context<UpdateManifest>,
    manifest_uri: [u8; MANIFEST_URI_LEN],
    capability_mask: u128,
    price_lamports: u64,
    stream_rate: u64,
) -> Result<()> {
    let g = &ctx.accounts.global;
    require!(!g.paused, AgentRegistryError::Paused);

    let agent = &mut ctx.accounts.agent;
    require!(
        matches!(agent.status, AgentStatus::Active | AgentStatus::Paused),
        AgentRegistryError::InvalidStatusTransition
    );
    validate_manifest_uri(&manifest_uri)?;
    capability_check(ctx.accounts.capability_config.approved_mask, capability_mask)?;

    agent.manifest_uri = manifest_uri;
    agent.capability_mask = capability_mask;
    agent.price_lamports = price_lamports;
    agent.stream_rate = stream_rate;
    agent.version = agent.version.checked_add(1).ok_or(AgentRegistryError::ArithmeticOverflow)?;
    let now = Clock::get()?.unix_timestamp;
    agent.last_active = now;

    emit!(ManifestUpdated {
        agent_did: agent.did,
        version: agent.version,
        capability_mask,
        timestamp: now,
    });
    Ok(())
}
