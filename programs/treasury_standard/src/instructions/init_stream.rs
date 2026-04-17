use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, TokenInterface, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount};

use fee_collector::{assert_hook_allowed_at_site, HookAllowlist, SITE_INIT_STREAM};

use crate::errors::TreasuryError;
use crate::events::{GuardEntered, StreamInitialized};
use crate::guard::{exit as guard_exit, try_enter, ReentrancyGuard, SEED_GUARD};
use crate::state::{
    assert_call_target_allowed, resolve_hook_allowlist, AgentTreasury, AllowedMints,
    AllowedTargets, PaymentStream, StreamStatus, TreasuryGlobal,
};

#[derive(Accounts)]
#[instruction(stream_nonce: [u8; 8])]
pub struct InitStream<'info> {
    #[account(seeds = [b"treasury_global"], bump = global.bump)]
    pub global: Box<Account<'info, TreasuryGlobal>>,

    #[account(
        seeds = [b"allowed_mints"],
        bump = allowed_mints.bump,
        address = global.allowed_mints,
    )]
    pub allowed_mints: Box<Account<'info, AllowedMints>>,

    #[account(
        mut,
        seeds = [b"treasury", treasury.agent_did.as_ref()],
        bump = treasury.bump,
    )]
    pub treasury: Box<Account<'info, AgentTreasury>>,

    #[account(
        seeds = [b"allowed_targets", treasury.agent_did.as_ref()],
        bump = allowed_targets.bump,
    )]
    pub allowed_targets: Option<Account<'info, AllowedTargets>>,

    #[account(
        init,
        payer = client,
        space = 8 + PaymentStream::INIT_SPACE,
        seeds = [
            b"stream",
            treasury.agent_did.as_ref(),
            client.key().as_ref(),
            stream_nonce.as_ref(),
        ],
        bump,
    )]
    pub stream: Box<Account<'info, PaymentStream>>,

    pub payer_mint: Box<InterfaceAccount<'info, Mint>>,
    pub payout_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = client,
        token::mint = payer_mint,
        token::authority = escrow,
        token::token_program = token_program,
        seeds = [b"stream_escrow", stream.key().as_ref()],
        bump,
    )]
    pub escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = payer_mint,
        token::authority = client,
        token::token_program = token_program,
    )]
    pub client_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub hook_allowlist: Option<Account<'info, HookAllowlist>>,

    #[account(mut, seeds = [SEED_GUARD], bump = guard.bump)]
    pub guard: Box<Account<'info, ReentrancyGuard>>,

    #[account(mut)]
    pub client: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<InitStream>,
    stream_nonce: [u8; 8],
    rate_per_sec: u64,
    max_duration: i64,
) -> Result<()> {
    let clock = Clock::get()?;
    try_enter(&mut ctx.accounts.guard, crate::ID, clock.slot)?;
    emit!(GuardEntered {
        program: crate::ID,
        caller: crate::ID,
        slot: clock.slot,
        stack_height: 1,
    });

    let g = &ctx.accounts.global;
    require!(!g.paused, TreasuryError::Paused);
    require!(rate_per_sec > 0, TreasuryError::InvalidRate);
    require!(
        max_duration > 0 && max_duration <= g.max_stream_duration,
        TreasuryError::InvalidDuration
    );

    let t = &mut ctx.accounts.treasury;
    require!(!t.streaming_active, TreasuryError::StreamAlreadyActive);

    let payer = ctx.accounts.payer_mint.key();
    let payout = ctx.accounts.payout_mint.key();
    let list = &ctx.accounts.allowed_mints.mints;
    require!(list.iter().any(|m| m == &payer), TreasuryError::MintNotAllowed);
    require!(list.iter().any(|m| m == &payout), TreasuryError::MintNotAllowed);

    let deposit_total = rate_per_sec
        .checked_mul(max_duration as u64)
        .ok_or(TreasuryError::ArithmeticOverflow)?;

    let now = clock.unix_timestamp;

    let s = &mut ctx.accounts.stream;
    s.agent_did = t.agent_did;
    s.client = ctx.accounts.client.key();
    s.payer_mint = payer;
    s.payout_mint = payout;
    s.rate_per_sec = rate_per_sec;
    s.start_time = now;
    s.max_duration = max_duration;
    s.deposit_total = deposit_total;
    s.withdrawn = 0;
    s.escrow_bump = ctx.bumps.escrow;
    s.status = StreamStatus::Active;
    s.stream_nonce = stream_nonce;
    s.bump = ctx.bumps.stream;

    t.streaming_active = true;
    t.stream_counterparty = Some(ctx.accounts.client.key());
    t.stream_rate_per_sec = rate_per_sec;

    let decimals = ctx.accounts.payer_mint.decimals;
    let token_program_key = ctx.accounts.token_program.key();
    assert_call_target_allowed(
        &ctx.accounts.global,
        ctx.accounts.allowed_targets.as_deref(),
        &token_program_key,
    )?;
    if let Some(g) = resolve_hook_allowlist(
        &ctx.accounts.global,
        ctx.accounts.hook_allowlist.as_ref(),
    )? {
        assert_hook_allowed_at_site(
            &ctx.accounts.payer_mint.to_account_info(),
            g,
            None,
            SITE_INIT_STREAM,
        )
        .map_err(|_| error!(TreasuryError::HookNotAllowed))?;
    }
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.client_token_account.to_account_info(),
        mint: ctx.accounts.payer_mint.to_account_info(),
        to: ctx.accounts.escrow.to_account_info(),
        authority: ctx.accounts.client.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(token_program_key, cpi_accounts);
    transfer_checked(cpi_ctx, deposit_total, decimals)?;

    emit!(StreamInitialized {
        agent_did: t.agent_did,
        client: ctx.accounts.client.key(),
        payer_mint: payer,
        payout_mint: payout,
        rate_per_sec,
        max_duration,
        deposit_total,
        timestamp: now,
    });

    guard_exit(&mut ctx.accounts.guard);
    Ok(())
}
