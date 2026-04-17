use anchor_lang::prelude::*;

use crate::state::{TemplateRegistryGlobal, MAX_ROYALTY_BPS};
use crate::errors::TemplateRegistryError;

#[derive(Accounts)]
pub struct SetGlobalParams<'info> {
    #[account(
        mut,
        seeds = [b"tpl_global"],
        bump = global.bump,
        has_one = authority @ TemplateRegistryError::Unauthorized,
    )]
    pub global: Box<Account<'info, TemplateRegistryGlobal>>,

    pub authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<SetGlobalParams>,
    paused: Option<bool>,
    royalty_cap_bps: Option<u16>,
    platform_fee_bps: Option<u16>,
) -> Result<()> {
    let g = &mut ctx.accounts.global;

    if let Some(p) = paused {
        g.paused = p;
    }

    if let Some(cap) = royalty_cap_bps {
        require!(cap <= MAX_ROYALTY_BPS, TemplateRegistryError::RoyaltyExceedsCap);
        require!(cap <= g.royalty_cap_bps, TemplateRegistryError::RoyaltyExceedsCap);
        g.royalty_cap_bps = cap;
    }

    if let Some(fee) = platform_fee_bps {
        let effective_cap = royalty_cap_bps.unwrap_or(g.royalty_cap_bps);
        require!(
            (fee as u32) + (effective_cap as u32) <= 10_000,
            TemplateRegistryError::FeeSplitExceeds100,
        );
        g.platform_fee_bps = fee;
    }

    Ok(())
}
