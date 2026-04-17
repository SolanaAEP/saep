use anchor_lang::prelude::*;

use crate::errors::TemplateRegistryError;
use crate::events::TemplateForked;
use crate::state::{AgentTemplate, TemplateFork, TemplateRegistryGlobal, TemplateStatus, MAX_LINEAGE_DEPTH};

#[derive(Accounts)]
#[instruction(child_agent_did: [u8; 32])]
pub struct ForkTemplate<'info> {
    #[account(seeds = [b"tpl_global"], bump = global.bump)]
    pub global: Box<Account<'info, TemplateRegistryGlobal>>,

    #[account(
        mut,
        seeds = [b"template", parent.template_id.as_ref()],
        bump = parent.bump,
    )]
    pub parent: Box<Account<'info, AgentTemplate>>,

    #[account(
        init,
        payer = forker,
        space = 8 + TemplateFork::INIT_SPACE,
        seeds = [b"fork", child_agent_did.as_ref()],
        bump,
    )]
    pub fork: Box<Account<'info, TemplateFork>>,

    #[account(mut)]
    pub forker: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<ForkTemplate>,
    child_agent_did: [u8; 32],
) -> Result<()> {
    require!(!ctx.accounts.global.paused, TemplateRegistryError::Paused);

    let parent = &ctx.accounts.parent;
    require!(
        parent.status == TemplateStatus::Published,
        TemplateRegistryError::InvalidStatus,
    );
    require!(
        parent.lineage_depth < MAX_LINEAGE_DEPTH,
        TemplateRegistryError::LineageDepthExceeded,
    );

    let now = Clock::get()?.unix_timestamp;

    let fork = &mut ctx.accounts.fork;
    fork.child_agent_did = child_agent_did;
    fork.parent_template = ctx.accounts.parent.key();
    fork.forker = ctx.accounts.forker.key();
    fork.royalty_bps_snapshot = parent.royalty_bps;
    fork.forked_at = now;
    fork.bump = ctx.bumps.fork;

    let parent = &mut ctx.accounts.parent;
    parent.fork_count = parent.fork_count.saturating_add(1);

    emit!(TemplateForked {
        template_id: parent.template_id,
        child_agent_did,
        forker: ctx.accounts.forker.key(),
        royalty_bps_snapshot: fork.royalty_bps_snapshot,
    });

    Ok(())
}
