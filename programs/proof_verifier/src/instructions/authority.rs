use anchor_lang::prelude::*;

use crate::errors::ProofVerifierError;
use crate::events::{AuthorityTransferAccepted, AuthorityTransferProposed};
use crate::state::VerifierConfig;

#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    #[account(
        mut,
        seeds = [b"verifier_config"],
        bump = config.bump,
        has_one = authority @ ProofVerifierError::Unauthorized,
    )]
    pub config: Account<'info, VerifierConfig>,

    pub authority: Signer<'info>,
}

pub fn transfer_authority_handler(
    ctx: Context<TransferAuthority>,
    new_authority: Pubkey,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.pending_authority = Some(new_authority);
    emit!(AuthorityTransferProposed { pending: new_authority });
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    #[account(
        mut,
        seeds = [b"verifier_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, VerifierConfig>,

    pub pending_authority: Signer<'info>,
}

pub fn accept_authority_handler(ctx: Context<AcceptAuthority>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let pending = config
        .pending_authority
        .ok_or(ProofVerifierError::NoPendingAuthority)?;
    require_keys_eq!(
        pending,
        ctx.accounts.pending_authority.key(),
        ProofVerifierError::Unauthorized
    );

    config.authority = pending;
    config.pending_authority = None;
    emit!(AuthorityTransferAccepted { new_authority: pending });
    Ok(())
}
