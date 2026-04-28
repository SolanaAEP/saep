use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use fee_collector::{
    inspect_mint_extensions, HookAllowlist, MINT_FLAG_CONFIDENTIAL_TRANSFER_OK,
    MINT_FLAG_NO_FROZEN_DEFAULT, MINT_FLAG_NO_TRANSFER_FEE,
};

use crate::errors::TaskMarketError;
use crate::events::{GlobalParamsUpdated, MintAccepted};
use crate::state::{MarketGlobal, MintAcceptRecord, ALLOWED_MINTS_LEN, SEED_MINT_ACCEPT};

#[derive(Accounts)]
#[instruction(slot: u8)]
pub struct AllowPaymentMint<'info> {
    #[account(
        mut,
        seeds = [b"market_global"],
        bump = global.bump,
        has_one = authority @ TaskMarketError::Unauthorized,
    )]
    pub global: Account<'info, MarketGlobal>,

    pub authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = payer,
        space = 8 + MintAcceptRecord::INIT_SPACE,
        seeds = [SEED_MINT_ACCEPT, mint.key().as_ref()],
        bump,
    )]
    pub mint_accept: Account<'info, MintAcceptRecord>,

    pub hook_allowlist: Option<Account<'info, HookAllowlist>>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AllowPaymentMint>, slot: u8) -> Result<()> {
    let slot = slot as usize;
    require!(slot < ALLOWED_MINTS_LEN, TaskMarketError::InvalidAmount);

    let mint_info = ctx.accounts.mint.to_account_info();
    let report = inspect_mint_extensions(&mint_info)
        .map_err(|_| error!(TaskMarketError::MintExtensionRejected))?;

    // Sanity checks mandated by spec §Mint-extension sanity checks.
    let mut flags: u32 = 0;
    let no_fee = !report.has_transfer_fee_ext
        || report
            .transfer_fee_authority
            .map(|auth| auth == ctx.accounts.global.authority)
            .unwrap_or(false);
    require!(no_fee, TaskMarketError::MintExtensionRejected);
    flags |= MINT_FLAG_NO_TRANSFER_FEE;

    require!(
        !report.default_state_frozen,
        TaskMarketError::MintExtensionRejected
    );
    flags |= MINT_FLAG_NO_FROZEN_DEFAULT;

    flags |= MINT_FLAG_CONFIDENTIAL_TRANSFER_OK;

    let clock = Clock::get()?;
    let mint_key = ctx.accounts.mint.key();

    let record = &mut ctx.accounts.mint_accept;
    record.mint = mint_key;
    record.mint_accept_flags = flags;
    record.has_confidential_transfer = report.has_confidential_transfer_ext;
    record.accepted_at_slot = clock.slot;
    record.accepted_at_ts = clock.unix_timestamp;
    record.bump = ctx.bumps.mint_accept;

    // Write into MarketGlobal.allowed_payment_mints[slot].
    ctx.accounts.global.allowed_payment_mints[slot] = mint_key;

    emit!(MintAccepted {
        mint: mint_key,
        accept_flags: flags,
        has_confidential_transfer: report.has_confidential_transfer_ext,
        slot: clock.slot,
        timestamp: clock.unix_timestamp,
    });
    emit!(GlobalParamsUpdated {
        timestamp: clock.unix_timestamp,
    });
    Ok(())
}
