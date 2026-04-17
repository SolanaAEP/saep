use anchor_lang::prelude::*;

use crate::state::{TemplateRegistryGlobal, MAX_ROYALTY_BPS};
use crate::errors::TemplateRegistryError;

#[derive(Accounts)]
pub struct InitGlobal<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + TemplateRegistryGlobal::INIT_SPACE,
        seeds = [b"tpl_global"],
        bump,
    )]
    pub global: Box<Account<'info, TemplateRegistryGlobal>>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitGlobal>,
    agent_registry: Pubkey,
    treasury_standard: Pubkey,
    fee_collector: Pubkey,
    royalty_cap_bps: u16,
    platform_fee_bps: u16,
    rent_escrow_mint: Pubkey,
) -> Result<()> {
    require!(royalty_cap_bps <= MAX_ROYALTY_BPS, TemplateRegistryError::RoyaltyExceedsCap);
    require!(
        (platform_fee_bps as u32) + (royalty_cap_bps as u32) <= 10_000,
        TemplateRegistryError::FeeSplitExceeds100,
    );

    let g = &mut ctx.accounts.global;
    g.authority = ctx.accounts.authority.key();
    g.pending_authority = None;
    g.agent_registry = agent_registry;
    g.treasury_standard = treasury_standard;
    g.fee_collector = fee_collector;
    g.royalty_cap_bps = royalty_cap_bps;
    g.platform_fee_bps = platform_fee_bps;
    g.rent_escrow_mint = rent_escrow_mint;
    g.paused = false;
    g.bump = ctx.bumps.global;
    Ok(())
}
