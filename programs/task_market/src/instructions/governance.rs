use anchor_lang::prelude::*;

use crate::errors::TaskMarketError;
use crate::events::{GlobalParamsUpdated, PausedSet};
use crate::state::{MarketGlobal, MAX_PROTOCOL_FEE_BPS, MAX_SOLREP_FEE_BPS};

#[derive(Accounts)]
pub struct GovernanceUpdate<'info> {
    #[account(
        mut,
        seeds = [b"market_global"],
        bump = global.bump,
        has_one = authority @ TaskMarketError::Unauthorized,
    )]
    pub global: Account<'info, MarketGlobal>,
    pub authority: Signer<'info>,
}

pub fn set_allowed_mint_handler(
    ctx: Context<GovernanceUpdate>,
    slot: u8,
    mint: Pubkey,
) -> Result<()> {
    let g = &mut ctx.accounts.global;
    let slot = slot as usize;
    require!(slot < g.allowed_payment_mints.len(), TaskMarketError::InvalidAmount);
    g.allowed_payment_mints[slot] = mint;
    emit!(GlobalParamsUpdated {
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn set_fees_handler(
    ctx: Context<GovernanceUpdate>,
    protocol_fee_bps: u16,
    solrep_fee_bps: u16,
) -> Result<()> {
    require!(
        protocol_fee_bps <= MAX_PROTOCOL_FEE_BPS,
        TaskMarketError::FeeBoundExceeded
    );
    require!(
        solrep_fee_bps <= MAX_SOLREP_FEE_BPS,
        TaskMarketError::FeeBoundExceeded
    );
    let g = &mut ctx.accounts.global;
    g.protocol_fee_bps = protocol_fee_bps;
    g.solrep_fee_bps = solrep_fee_bps;
    emit!(GlobalParamsUpdated {
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn set_paused_handler(ctx: Context<GovernanceUpdate>, paused: bool) -> Result<()> {
    ctx.accounts.global.paused = paused;
    emit!(PausedSet {
        paused,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn set_hook_allowlist_ptr_handler(
    ctx: Context<GovernanceUpdate>,
    hook_allowlist: Pubkey,
) -> Result<()> {
    let g = &mut ctx.accounts.global;
    require!(
        g.hook_allowlist == Pubkey::default(),
        TaskMarketError::HookAllowlistMismatch
    );
    require!(
        hook_allowlist != Pubkey::default(),
        TaskMarketError::Unauthorized
    );
    g.hook_allowlist = hook_allowlist;
    emit!(GlobalParamsUpdated {
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
