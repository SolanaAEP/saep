use anchor_lang::prelude::*;

use crate::errors::FeeCollectorError;
use crate::events::{HookAllowlistInitialized, HookAllowlistUpdated};
use crate::state::{HookAllowlist, MAX_HOOK_PROGRAMS, SEED_HOOK_ALLOWLIST};

#[derive(Accounts)]
pub struct InitHookAllowlist<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + HookAllowlist::INIT_SPACE,
        seeds = [SEED_HOOK_ALLOWLIST],
        bump,
    )]
    pub allowlist: Account<'info, HookAllowlist>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: authority pubkey is stored verbatim; governance key identity is
    /// enforced on later mutation ixs.
    pub authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn init_handler(ctx: Context<InitHookAllowlist>, default_deny: bool) -> Result<()> {
    let a = &mut ctx.accounts.allowlist;
    a.authority = ctx.accounts.authority.key();
    a.pending_authority = None;
    a.programs = Vec::with_capacity(MAX_HOOK_PROGRAMS);
    a.default_deny = default_deny;
    a.bump = ctx.bumps.allowlist;

    emit!(HookAllowlistInitialized {
        authority: a.authority,
        default_deny,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateHookAllowlist<'info> {
    #[account(
        mut,
        seeds = [SEED_HOOK_ALLOWLIST],
        bump = allowlist.bump,
        has_one = authority @ FeeCollectorError::Unauthorized,
    )]
    pub allowlist: Account<'info, HookAllowlist>,

    pub authority: Signer<'info>,
}

pub fn update_handler(
    ctx: Context<UpdateHookAllowlist>,
    add: Vec<Pubkey>,
    remove: Vec<Pubkey>,
) -> Result<()> {
    let a = &mut ctx.accounts.allowlist;

    for r in &remove {
        a.programs.retain(|p| p != r);
    }
    for p in &add {
        require!(*p != Pubkey::default(), FeeCollectorError::InvalidProgramId);
        if !a.programs.iter().any(|e| e == p) {
            a.programs.push(*p);
        }
    }
    require!(
        a.programs.len() <= MAX_HOOK_PROGRAMS,
        FeeCollectorError::HookAllowlistFull
    );

    emit!(HookAllowlistUpdated {
        added: add,
        removed: remove,
        default_deny: a.default_deny,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn set_default_deny_handler(
    ctx: Context<UpdateHookAllowlist>,
    default_deny: bool,
) -> Result<()> {
    let a = &mut ctx.accounts.allowlist;
    a.default_deny = default_deny;

    emit!(HookAllowlistUpdated {
        added: vec![],
        removed: vec![],
        default_deny,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct TransferHookAuthority<'info> {
    #[account(
        mut,
        seeds = [SEED_HOOK_ALLOWLIST],
        bump = allowlist.bump,
        has_one = authority @ FeeCollectorError::Unauthorized,
    )]
    pub allowlist: Account<'info, HookAllowlist>,
    pub authority: Signer<'info>,
}

pub fn transfer_authority_handler(
    ctx: Context<TransferHookAuthority>,
    new_authority: Pubkey,
) -> Result<()> {
    ctx.accounts.allowlist.pending_authority = Some(new_authority);
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptHookAuthority<'info> {
    #[account(mut, seeds = [SEED_HOOK_ALLOWLIST], bump = allowlist.bump)]
    pub allowlist: Account<'info, HookAllowlist>,
    pub pending_authority: Signer<'info>,
}

pub fn accept_authority_handler(ctx: Context<AcceptHookAuthority>) -> Result<()> {
    let a = &mut ctx.accounts.allowlist;
    let pending = a
        .pending_authority
        .ok_or(FeeCollectorError::NoPendingAuthority)?;
    require_keys_eq!(
        pending,
        ctx.accounts.pending_authority.key(),
        FeeCollectorError::Unauthorized
    );
    a.authority = pending;
    a.pending_authority = None;
    Ok(())
}
