use anchor_lang::prelude::*;

use crate::errors::TreasuryError;
use crate::events::{AllowedMintAdded, AllowedMintRemoved};
use crate::state::{AllowedMints, TreasuryGlobal, MAX_ALLOWED_MINTS};

#[derive(Accounts)]
pub struct GovernMints<'info> {
    #[account(
        seeds = [b"treasury_global"],
        bump = global.bump,
        has_one = authority @ TreasuryError::Unauthorized,
    )]
    pub global: Account<'info, TreasuryGlobal>,

    #[account(
        mut,
        seeds = [b"allowed_mints"],
        bump = allowed_mints.bump,
        address = global.allowed_mints,
    )]
    pub allowed_mints: Account<'info, AllowedMints>,

    pub authority: Signer<'info>,
}

pub fn add_allowed_mint_handler(ctx: Context<GovernMints>, mint: Pubkey) -> Result<()> {
    let a = &mut ctx.accounts.allowed_mints;
    require!(a.mints.len() < MAX_ALLOWED_MINTS, TreasuryError::AllowedMintsFull);
    require!(
        !a.mints.iter().any(|m| m == &mint),
        TreasuryError::InvalidLimits
    );
    a.mints.push(mint);
    emit!(AllowedMintAdded {
        mint,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn remove_allowed_mint_handler(ctx: Context<GovernMints>, mint: Pubkey) -> Result<()> {
    let a = &mut ctx.accounts.allowed_mints;
    let idx = a
        .mints
        .iter()
        .position(|m| m == &mint)
        .ok_or(TreasuryError::MintNotFound)?;
    a.mints.swap_remove(idx);
    emit!(AllowedMintRemoved {
        mint,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
