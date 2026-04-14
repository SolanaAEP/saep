use anchor_lang::prelude::*;
use anchor_spl::token_2022::{transfer_checked, Token2022, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::errors::TreasuryError;
use crate::events::StreamClosed;
use crate::state::{AgentTreasury, PaymentStream, StreamStatus};

#[derive(Accounts)]
pub struct CloseStream<'info> {
    #[account(
        mut,
        seeds = [b"treasury", treasury.agent_did.as_ref()],
        bump = treasury.bump,
    )]
    pub treasury: Account<'info, AgentTreasury>,

    #[account(
        mut,
        seeds = [b"stream", stream.agent_did.as_ref(), stream.client.as_ref(), stream.stream_nonce.as_ref()],
        bump = stream.bump,
    )]
    pub stream: Account<'info, PaymentStream>,

    pub payer_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"stream_escrow", stream.key().as_ref()],
        bump = stream.escrow_bump,
        token::mint = payer_mint,
    )]
    pub escrow: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault", treasury.agent_did.as_ref(), payer_mint.key().as_ref()],
        bump,
        token::mint = payer_mint,
    )]
    pub agent_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, token::mint = payer_mint, token::token_program = token_program)]
    pub client_token_account: InterfaceAccount<'info, TokenAccount>,

    pub signer: Signer<'info>,
    pub token_program: Program<'info, Token2022>,
}

pub fn handler(ctx: Context<CloseStream>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let s = &mut ctx.accounts.stream;
    require!(s.status == StreamStatus::Active, TreasuryError::StreamAlreadyClosed);

    let signer_key = ctx.accounts.signer.key();
    require!(
        signer_key == s.client || signer_key == ctx.accounts.treasury.operator,
        TreasuryError::Unauthorized
    );

    let raw_elapsed = now
        .checked_sub(s.start_time)
        .ok_or(TreasuryError::ArithmeticOverflow)?
        .max(0);
    let elapsed = raw_elapsed.min(s.max_duration);
    let earned = s
        .rate_per_sec
        .checked_mul(elapsed as u64)
        .ok_or(TreasuryError::ArithmeticOverflow)?
        .min(s.deposit_total);

    let agent_receipts = earned
        .checked_sub(s.withdrawn)
        .ok_or(TreasuryError::ArithmeticOverflow)?;
    let client_refund = s
        .deposit_total
        .checked_sub(earned)
        .ok_or(TreasuryError::ArithmeticOverflow)?;

    s.withdrawn = earned;
    s.status = StreamStatus::Closed;

    let t = &mut ctx.accounts.treasury;
    t.streaming_active = false;
    t.stream_counterparty = None;
    t.stream_rate_per_sec = 0;

    let stream_key = ctx.accounts.stream.key();
    let escrow_bump = ctx.accounts.stream.escrow_bump;
    let seeds: &[&[u8]] = &[
        b"stream_escrow",
        stream_key.as_ref(),
        core::slice::from_ref(&escrow_bump),
    ];
    let signer = &[seeds];
    let decimals = ctx.accounts.payer_mint.decimals;

    if agent_receipts > 0 {
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.escrow.to_account_info(),
            mint: ctx.accounts.payer_mint.to_account_info(),
            to: ctx.accounts.agent_vault.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        let cpi_ctx =
            CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer);
        transfer_checked(cpi_ctx, agent_receipts, decimals)?;
    }

    if client_refund > 0 {
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.escrow.to_account_info(),
            mint: ctx.accounts.payer_mint.to_account_info(),
            to: ctx.accounts.client_token_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        let cpi_ctx =
            CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer);
        transfer_checked(cpi_ctx, client_refund, decimals)?;
    }

    emit!(StreamClosed {
        agent_did: ctx.accounts.stream.agent_did,
        agent_receipts,
        client_refund,
        timestamp: now,
    });
    Ok(())
}
