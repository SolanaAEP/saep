use anchor_lang::prelude::*;
use anchor_spl::token_2022::{transfer_checked, Token2022, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::errors::TreasuryError;
use crate::events::StreamWithdrawn;
use crate::state::{
    guard_oracle, read_price, swap_via_jupiter, AgentTreasury, PaymentStream, StreamStatus,
    TreasuryGlobal, BPS_DENOM, DEFAULT_SLIPPAGE_BPS,
};

#[derive(Accounts)]
pub struct WithdrawEarned<'info> {
    #[account(seeds = [b"treasury_global"], bump = global.bump)]
    pub global: Account<'info, TreasuryGlobal>,

    #[account(
        seeds = [b"treasury", treasury.agent_did.as_ref()],
        bump = treasury.bump,
        has_one = operator @ TreasuryError::Unauthorized,
    )]
    pub treasury: Account<'info, AgentTreasury>,

    #[account(
        mut,
        seeds = [b"stream", stream.agent_did.as_ref(), stream.client.as_ref(), stream.stream_nonce.as_ref()],
        bump = stream.bump,
    )]
    pub stream: Account<'info, PaymentStream>,

    pub payer_mint: InterfaceAccount<'info, Mint>,
    pub payout_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"stream_escrow", stream.key().as_ref()],
        bump = stream.escrow_bump,
        token::mint = payer_mint,
    )]
    pub escrow: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault", treasury.agent_did.as_ref(), payout_mint.key().as_ref()],
        bump,
        token::mint = payout_mint,
    )]
    pub agent_vault: InterfaceAccount<'info, TokenAccount>,

    pub operator: Signer<'info>,
    pub token_program: Program<'info, Token2022>,
}

pub fn handler(ctx: Context<WithdrawEarned>) -> Result<()> {
    require!(!ctx.accounts.global.paused, TreasuryError::Paused);

    let now = Clock::get()?.unix_timestamp;
    let s = &mut ctx.accounts.stream;
    require!(s.status == StreamStatus::Active, TreasuryError::StreamNotActive);
    require!(now > s.start_time, TreasuryError::InvalidDuration);

    let raw_elapsed = now
        .checked_sub(s.start_time)
        .ok_or(TreasuryError::ArithmeticOverflow)?;
    let elapsed = raw_elapsed.min(s.max_duration);

    let earned = s
        .rate_per_sec
        .checked_mul(elapsed as u64)
        .ok_or(TreasuryError::ArithmeticOverflow)?
        .min(s.deposit_total);

    require!(earned >= s.withdrawn, TreasuryError::ArithmeticOverflow);
    let claimable = earned
        .checked_sub(s.withdrawn)
        .ok_or(TreasuryError::ArithmeticOverflow)?;
    require!(claimable > 0, TreasuryError::ZeroAmount);

    s.withdrawn = earned;

    let agent_did = s.agent_did;
    let client = s.client;
    let nonce = s.stream_nonce;
    let stream_bump = s.bump;
    let swapped = s.payer_mint != s.payout_mint;

    let stream_key = s.key();

    let escrow_seeds: &[&[u8]] = &[
        b"stream_escrow",
        stream_key.as_ref(),
        core::slice::from_ref(&s.escrow_bump),
    ];
    let escrow_signer = &[escrow_seeds];

    let stream_seeds: &[&[u8]] = &[
        b"stream",
        agent_did.as_ref(),
        client.as_ref(),
        nonce.as_ref(),
        core::slice::from_ref(&stream_bump),
    ];
    let _ = stream_seeds;

    let payout_amount = if swapped {
        let price = read_price(&ctx.accounts.payer_mint.key(), &ctx.accounts.payout_mint.key())?;
        guard_oracle(&price)?;
        let ideal = claimable
            .checked_mul(price.price)
            .ok_or(TreasuryError::ArithmeticOverflow)?;
        let min_out = ideal
            .checked_mul(BPS_DENOM - DEFAULT_SLIPPAGE_BPS)
            .ok_or(TreasuryError::ArithmeticOverflow)?
            / BPS_DENOM;
        let out = swap_via_jupiter(
            &ctx.accounts.payer_mint.key(),
            &ctx.accounts.payout_mint.key(),
            claimable,
            min_out,
        )?;
        require!(out >= min_out, TreasuryError::SwapSlippage);
        out
    } else {
        let decimals = ctx.accounts.payer_mint.decimals;
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.escrow.to_account_info(),
            mint: ctx.accounts.payer_mint.to_account_info(),
            to: ctx.accounts.agent_vault.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi_accounts,
            escrow_signer,
        );
        transfer_checked(cpi_ctx, claimable, decimals)?;
        claimable
    };

    emit!(StreamWithdrawn {
        agent_did,
        claimable: payout_amount,
        swapped,
        timestamp: now,
    });
    Ok(())
}
