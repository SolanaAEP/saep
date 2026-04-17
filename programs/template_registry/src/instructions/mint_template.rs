use anchor_lang::prelude::*;

use crate::errors::TemplateRegistryError;
use crate::events::TemplatePublished;
use crate::state::{AgentTemplate, TemplateRegistryGlobal, TemplateStatus, CONFIG_URI_LEN, MAX_RENT_DURATION_SECS};

#[derive(Accounts)]
#[instruction(template_id: [u8; 32])]
pub struct MintTemplate<'info> {
    #[account(seeds = [b"tpl_global"], bump = global.bump)]
    pub global: Box<Account<'info, TemplateRegistryGlobal>>,

    #[account(
        init,
        payer = author,
        space = 8 + AgentTemplate::INIT_SPACE,
        seeds = [b"template", template_id.as_ref()],
        bump,
    )]
    pub template: Box<Account<'info, AgentTemplate>>,

    #[account(mut)]
    pub author: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<MintTemplate>,
    template_id: [u8; 32],
    config_hash: [u8; 32],
    config_uri: [u8; CONFIG_URI_LEN],
    capability_mask: u128,
    royalty_bps: u16,
    rent_price_per_sec: u64,
    min_rent_duration: i64,
    max_rent_duration: i64,
) -> Result<()> {
    require!(!ctx.accounts.global.paused, TemplateRegistryError::Paused);
    require!(
        royalty_bps <= ctx.accounts.global.royalty_cap_bps,
        TemplateRegistryError::RoyaltyExceedsCap,
    );
    if rent_price_per_sec > 0 {
        require!(
            min_rent_duration > 0
                && max_rent_duration >= min_rent_duration
                && max_rent_duration <= MAX_RENT_DURATION_SECS,
            TemplateRegistryError::RentalDurationOutOfBounds,
        );
    }

    let now = Clock::get()?.unix_timestamp;
    let t = &mut ctx.accounts.template;
    t.template_id = template_id;
    t.author = ctx.accounts.author.key();
    t.config_hash = config_hash;
    t.config_uri = config_uri;
    t.capability_mask = capability_mask;
    t.royalty_bps = royalty_bps;
    t.parent_template = None;
    t.lineage_depth = 0;
    t.fork_count = 0;
    t.rent_count = 0;
    t.total_revenue = 0;
    t.rent_price_per_sec = rent_price_per_sec;
    t.min_rent_duration = min_rent_duration;
    t.max_rent_duration = max_rent_duration;
    t.status = TemplateStatus::Published;
    t.created_at = now;
    t.updated_at = now;
    t.bump = ctx.bumps.template;

    emit!(TemplatePublished {
        template_id,
        author: ctx.accounts.author.key(),
        config_hash,
        royalty_bps,
    });

    Ok(())
}
