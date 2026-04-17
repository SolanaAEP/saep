use anchor_lang::prelude::*;

use crate::errors::TemplateRegistryError;
use crate::events::TemplateRetired;
use crate::state::{AgentTemplate, TemplateRegistryGlobal, TemplateStatus};

#[derive(Accounts)]
pub struct RetireTemplate<'info> {
    #[account(seeds = [b"tpl_global"], bump = global.bump)]
    pub global: Box<Account<'info, TemplateRegistryGlobal>>,

    #[account(
        mut,
        seeds = [b"template", template.template_id.as_ref()],
        bump = template.bump,
    )]
    pub template: Box<Account<'info, AgentTemplate>>,

    pub signer: Signer<'info>,
}

pub fn handler(ctx: Context<RetireTemplate>) -> Result<()> {
    let is_author = ctx.accounts.signer.key() == ctx.accounts.template.author;
    let is_authority = ctx.accounts.signer.key() == ctx.accounts.global.authority;
    require!(is_author || is_authority, TemplateRegistryError::Unauthorized);

    let t = &mut ctx.accounts.template;
    require!(
        t.status != TemplateStatus::Retired,
        TemplateRegistryError::InvalidStatus,
    );

    t.status = TemplateStatus::Retired;
    t.updated_at = Clock::get()?.unix_timestamp;

    emit!(TemplateRetired {
        template_id: t.template_id,
        retired_by: ctx.accounts.signer.key(),
        timestamp: t.updated_at,
    });

    Ok(())
}
