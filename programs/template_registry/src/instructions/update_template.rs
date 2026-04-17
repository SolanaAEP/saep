use anchor_lang::prelude::*;

use crate::errors::TemplateRegistryError;
use crate::state::{AgentTemplate, TemplateRegistryGlobal, TemplateStatus, CONFIG_URI_LEN};

#[derive(Accounts)]
pub struct UpdateTemplate<'info> {
    #[account(seeds = [b"tpl_global"], bump = global.bump)]
    pub global: Box<Account<'info, TemplateRegistryGlobal>>,

    #[account(
        mut,
        seeds = [b"template", template.template_id.as_ref()],
        bump = template.bump,
        has_one = author @ TemplateRegistryError::Unauthorized,
    )]
    pub template: Box<Account<'info, AgentTemplate>>,

    pub author: Signer<'info>,
}

pub fn handler(
    ctx: Context<UpdateTemplate>,
    config_hash: [u8; 32],
    config_uri: [u8; CONFIG_URI_LEN],
) -> Result<()> {
    require!(!ctx.accounts.global.paused, TemplateRegistryError::Paused);
    let t = &ctx.accounts.template;
    require!(
        t.status == TemplateStatus::Published || t.status == TemplateStatus::Draft,
        TemplateRegistryError::InvalidStatus,
    );

    let t = &mut ctx.accounts.template;
    t.config_hash = config_hash;
    t.config_uri = config_uri;
    t.updated_at = Clock::get()?.unix_timestamp;
    Ok(())
}
