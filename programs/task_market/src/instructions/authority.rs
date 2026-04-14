use anchor_lang::prelude::*;

use crate::errors::TaskMarketError;
use crate::state::MarketGlobal;

#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    #[account(
        mut,
        seeds = [b"market_global"],
        bump = global.bump,
        has_one = authority @ TaskMarketError::Unauthorized,
    )]
    pub global: Account<'info, MarketGlobal>,
    pub authority: Signer<'info>,
}

pub fn transfer_authority_handler(
    ctx: Context<TransferAuthority>,
    new_authority: Pubkey,
) -> Result<()> {
    ctx.accounts.global.pending_authority = Some(new_authority);
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    #[account(mut, seeds = [b"market_global"], bump = global.bump)]
    pub global: Account<'info, MarketGlobal>,
    pub pending_authority: Signer<'info>,
}

pub fn accept_authority_handler(ctx: Context<AcceptAuthority>) -> Result<()> {
    let g = &mut ctx.accounts.global;
    let pending = g
        .pending_authority
        .ok_or(TaskMarketError::NoPendingAuthority)?;
    require_keys_eq!(
        pending,
        ctx.accounts.pending_authority.key(),
        TaskMarketError::Unauthorized
    );
    g.authority = pending;
    g.pending_authority = None;
    Ok(())
}
