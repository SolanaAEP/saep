use anchor_lang::prelude::*;

use crate::errors::TreasuryError;
use crate::state::TreasuryGlobal;

#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    #[account(
        mut,
        seeds = [b"treasury_global"],
        bump = global.bump,
        has_one = authority @ TreasuryError::Unauthorized,
    )]
    pub global: Account<'info, TreasuryGlobal>,
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
    #[account(mut, seeds = [b"treasury_global"], bump = global.bump)]
    pub global: Account<'info, TreasuryGlobal>,
    pub pending_authority: Signer<'info>,
}

pub fn accept_authority_handler(ctx: Context<AcceptAuthority>) -> Result<()> {
    let g = &mut ctx.accounts.global;
    let pending = g
        .pending_authority
        .ok_or(TreasuryError::NoPendingAuthority)?;
    require_keys_eq!(
        pending,
        ctx.accounts.pending_authority.key(),
        TreasuryError::Unauthorized
    );
    g.authority = pending;
    g.pending_authority = None;
    Ok(())
}
