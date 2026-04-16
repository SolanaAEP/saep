use anchor_lang::prelude::*;

use crate::errors::TreasuryError;
use crate::events::AllowedTargetsUpdated;
use crate::state::{
    apply_target_mutation, validate_and_dedup_targets, AgentTreasury, AllowedTargets,
};

#[derive(Accounts)]
#[instruction(agent_did: [u8; 32])]
pub struct InitAllowedTargets<'info> {
    #[account(
        seeds = [b"treasury", agent_did.as_ref()],
        bump = treasury.bump,
        has_one = operator @ TreasuryError::Unauthorized,
    )]
    pub treasury: Account<'info, AgentTreasury>,

    #[account(
        init,
        payer = operator,
        space = 8 + AllowedTargets::INIT_SPACE,
        seeds = [b"allowed_targets", agent_did.as_ref()],
        bump,
    )]
    pub allowed_targets: Account<'info, AllowedTargets>,

    #[account(mut)]
    pub operator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn init_handler(
    ctx: Context<InitAllowedTargets>,
    agent_did: [u8; 32],
    targets: Vec<Pubkey>,
) -> Result<()> {
    require!(
        ctx.accounts.treasury.agent_did == agent_did,
        TreasuryError::AgentMismatch
    );
    let deduped = validate_and_dedup_targets(&targets)?;
    let added_count = deduped.len() as u16;

    let a = &mut ctx.accounts.allowed_targets;
    a.agent_did = agent_did;
    a.targets = deduped;
    a.bump = ctx.bumps.allowed_targets;

    emit!(AllowedTargetsUpdated {
        agent_did,
        added_count,
        removed_count: 0,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateAllowedTargets<'info> {
    #[account(
        seeds = [b"treasury", treasury.agent_did.as_ref()],
        bump = treasury.bump,
        has_one = operator @ TreasuryError::Unauthorized,
    )]
    pub treasury: Account<'info, AgentTreasury>,

    #[account(
        mut,
        seeds = [b"allowed_targets", treasury.agent_did.as_ref()],
        bump = allowed_targets.bump,
    )]
    pub allowed_targets: Account<'info, AllowedTargets>,

    pub operator: Signer<'info>,
}

pub fn update_handler(
    ctx: Context<UpdateAllowedTargets>,
    add: Vec<Pubkey>,
    remove: Vec<Pubkey>,
) -> Result<()> {
    let a = &mut ctx.accounts.allowed_targets;
    let before_len = a.targets.len();
    let had: Vec<bool> = add.iter().map(|t| a.targets.iter().any(|e| e == t)).collect();
    apply_target_mutation(&mut a.targets, &add, &remove)?;

    let added_count = had.iter().filter(|h| !**h).count() as u16;
    let removed_count = (before_len + (added_count as usize))
        .saturating_sub(a.targets.len()) as u16;

    emit!(AllowedTargetsUpdated {
        agent_did: ctx.accounts.treasury.agent_did,
        added_count,
        removed_count,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
