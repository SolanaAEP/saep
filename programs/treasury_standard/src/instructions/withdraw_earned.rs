use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, TokenInterface, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount};

use fee_collector::{
    assert_hook_allowed_at_site, AgentHookAllowlist, HookAllowlist, SITE_STREAM_SWAP,
    SITE_STREAM_WITHDRAW,
};

use crate::errors::TreasuryError;
use crate::events::{GuardEntered, StreamWithdrawn, SwapExecuted};
use crate::guard::{exit as guard_exit, try_enter, ReentrancyGuard, SEED_GUARD};
use crate::jupiter;
use crate::state::{
    assert_call_target_allowed, compute_swap_min_out, guard_oracle, read_oracle,
    resolve_hook_allowlist, AgentTreasury, AllowedTargets, PaymentStream, StreamStatus,
    TreasuryGlobal, DEFAULT_SLIPPAGE_BPS, MAX_ROUTE_DATA_LEN,
};

#[derive(Accounts)]
pub struct WithdrawEarned<'info> {
    #[account(seeds = [b"treasury_global"], bump = global.bump)]
    pub global: Box<Account<'info, TreasuryGlobal>>,

    #[account(
        seeds = [b"treasury", treasury.agent_did.as_ref()],
        bump = treasury.bump,
        has_one = operator @ TreasuryError::Unauthorized,
    )]
    pub treasury: Box<Account<'info, AgentTreasury>>,

    #[account(
        seeds = [b"allowed_targets", treasury.agent_did.as_ref()],
        bump = allowed_targets.bump,
    )]
    pub allowed_targets: Option<Account<'info, AllowedTargets>>,

    #[account(
        mut,
        seeds = [b"stream", stream.agent_did.as_ref(), stream.client.as_ref(), stream.stream_nonce.as_ref()],
        bump = stream.bump,
    )]
    pub stream: Box<Account<'info, PaymentStream>>,

    pub payer_mint: Box<InterfaceAccount<'info, Mint>>,
    pub payout_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [b"stream_escrow", stream.key().as_ref()],
        bump = stream.escrow_bump,
        token::mint = payer_mint,
    )]
    pub escrow: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"vault", treasury.agent_did.as_ref(), payout_mint.key().as_ref()],
        bump,
        token::mint = payout_mint,
    )]
    pub agent_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: validated at runtime when swap path is taken
    pub jupiter_program: UncheckedAccount<'info>,

    /// CHECK: Pyth PriceUpdateV2 for payer_mint/USD — deserialized + validated via read_oracle
    pub payer_price_feed: Option<UncheckedAccount<'info>>,
    /// CHECK: Pyth PriceUpdateV2 for payout_mint/USD — deserialized + validated via read_oracle
    pub payout_price_feed: Option<UncheckedAccount<'info>>,

    pub hook_allowlist: Option<Account<'info, HookAllowlist>>,

    #[account(
        seeds = [b"agent_hooks", treasury.agent_did.as_ref()],
        bump = agent_hooks.bump,
        seeds::program = fee_collector::ID,
    )]
    pub agent_hooks: Option<Account<'info, AgentHookAllowlist>>,

    #[account(mut, seeds = [SEED_GUARD], bump = guard.bump)]
    pub guard: Box<Account<'info, ReentrancyGuard>>,

    pub operator: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler<'a>(ctx: Context<'a, WithdrawEarned<'a>>, route_data: Vec<u8>) -> Result<()> {
    let clock = Clock::get()?;
    try_enter(&mut ctx.accounts.guard, crate::ID, clock.slot)?;
    emit!(GuardEntered {
        program: crate::ID,
        caller: crate::ID,
        slot: clock.slot,
        stack_height: 1,
    });

    require!(
        route_data.len() <= MAX_ROUTE_DATA_LEN,
        TreasuryError::RouteDataTooLong
    );

    require!(!ctx.accounts.global.paused, TreasuryError::Paused);

    let now = clock.unix_timestamp;
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
    let swapped = s.payer_mint != s.payout_mint;

    let stream_key = s.key();
    let escrow_bump = s.escrow_bump;

    let escrow_seeds: &[&[u8]] = &[
        b"stream_escrow",
        stream_key.as_ref(),
        core::slice::from_ref(&escrow_bump),
    ];
    let escrow_signer = &[escrow_seeds];

    let hook_global = resolve_hook_allowlist(
        &ctx.accounts.global,
        ctx.accounts.hook_allowlist.as_ref(),
    )?;
    let hook_per_agent = ctx.accounts.agent_hooks.as_deref();

    let payout_amount = if swapped {
        require!(!route_data.is_empty(), TreasuryError::SwapRouteRequired);

        let jup = &ctx.accounts.jupiter_program;
        require!(
            jup.key() == ctx.accounts.global.jupiter_program,
            TreasuryError::InvalidJupiterProgram
        );
        require!(jup.executable, TreasuryError::InvalidJupiterProgram);
        let jup_key = jup.key();
        assert_call_target_allowed(
            &ctx.accounts.global,
            ctx.accounts.allowed_targets.as_deref(),
            &jup_key,
        )?;

        let payer_feed = ctx
            .accounts
            .payer_price_feed
            .as_ref()
            .ok_or(error!(TreasuryError::OracleRequired))?;
        let payout_feed = ctx
            .accounts
            .payout_price_feed
            .as_ref()
            .ok_or(error!(TreasuryError::OracleRequired))?;

        let payer_oracle = read_oracle(&payer_feed.to_account_info(), &clock)?;
        guard_oracle(&payer_oracle)?;
        let payout_oracle = read_oracle(&payout_feed.to_account_info(), &clock)?;
        guard_oracle(&payout_oracle)?;

        let min_out = compute_swap_min_out(
            claimable,
            &payer_oracle,
            &payout_oracle,
            ctx.accounts.payer_mint.decimals,
            ctx.accounts.payout_mint.decimals,
            DEFAULT_SLIPPAGE_BPS,
        )?;

        if let Some(g) = hook_global {
            assert_hook_allowed_at_site(
                &ctx.accounts.payer_mint.to_account_info(),
                g,
                hook_per_agent,
                SITE_STREAM_SWAP,
            )
            .map_err(|_| error!(TreasuryError::HookNotAllowed))?;
            assert_hook_allowed_at_site(
                &ctx.accounts.payout_mint.to_account_info(),
                g,
                hook_per_agent,
                SITE_STREAM_SWAP,
            )
            .map_err(|_| error!(TreasuryError::HookNotAllowed))?;
        }

        let escrow_before = ctx.accounts.escrow.amount;
        let vault_before = ctx.accounts.agent_vault.amount;

        let escrow_key = ctx.accounts.escrow.key();
        jupiter::execute_swap(
            &ctx.accounts.jupiter_program.to_account_info(),
            ctx.remaining_accounts,
            route_data,
            escrow_signer,
            &escrow_key,
        )?;

        ctx.accounts.escrow.reload()?;
        ctx.accounts.agent_vault.reload()?;

        let escrow_spent = escrow_before
            .checked_sub(ctx.accounts.escrow.amount)
            .ok_or(TreasuryError::ArithmeticOverflow)?;
        require!(escrow_spent <= claimable, TreasuryError::SwapAmountExceeded);

        let vault_received = ctx
            .accounts
            .agent_vault
            .amount
            .checked_sub(vault_before)
            .ok_or(TreasuryError::ArithmeticOverflow)?;
        require!(vault_received >= min_out, TreasuryError::SwapSlippage);

        emit!(SwapExecuted {
            agent_did,
            amount_in: escrow_spent,
            amount_out: vault_received,
            payer_mint: ctx.accounts.payer_mint.key(),
            payout_mint: ctx.accounts.payout_mint.key(),
            timestamp: now,
        });

        vault_received
    } else {
        let decimals = ctx.accounts.payer_mint.decimals;
        let token_program_key = ctx.accounts.token_program.key();
        assert_call_target_allowed(
            &ctx.accounts.global,
            ctx.accounts.allowed_targets.as_deref(),
            &token_program_key,
        )?;
        if let Some(g) = hook_global {
            assert_hook_allowed_at_site(
                &ctx.accounts.payer_mint.to_account_info(),
                g,
                hook_per_agent,
                SITE_STREAM_WITHDRAW,
            )
            .map_err(|_| error!(TreasuryError::HookNotAllowed))?;
        }
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.escrow.to_account_info(),
            mint: ctx.accounts.payer_mint.to_account_info(),
            to: ctx.accounts.agent_vault.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(token_program_key, cpi_accounts, escrow_signer);
        transfer_checked(cpi_ctx, claimable, decimals)?;
        claimable
    };

    emit!(StreamWithdrawn {
        agent_did,
        claimable: payout_amount,
        swapped,
        timestamp: now,
    });

    guard_exit(&mut ctx.accounts.guard);
    Ok(())
}
