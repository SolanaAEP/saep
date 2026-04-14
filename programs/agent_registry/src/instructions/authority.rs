use anchor_lang::prelude::*;

use crate::errors::AgentRegistryError;
use crate::state::RegistryGlobal;

#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    #[account(
        mut,
        seeds = [b"global"],
        bump = global.bump,
        has_one = authority @ AgentRegistryError::Unauthorized,
    )]
    pub global: Account<'info, RegistryGlobal>,
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
    #[account(mut, seeds = [b"global"], bump = global.bump)]
    pub global: Account<'info, RegistryGlobal>,
    pub pending_authority: Signer<'info>,
}

pub fn accept_authority_handler(ctx: Context<AcceptAuthority>) -> Result<()> {
    let g = &mut ctx.accounts.global;
    let pending = g
        .pending_authority
        .ok_or(AgentRegistryError::NoPendingAuthority)?;
    require_keys_eq!(
        pending,
        ctx.accounts.pending_authority.key(),
        AgentRegistryError::Unauthorized
    );
    g.authority = pending;
    g.pending_authority = None;
    Ok(())
}
