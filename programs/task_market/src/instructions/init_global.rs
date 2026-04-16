use anchor_lang::prelude::*;

use crate::errors::TaskMarketError;
use crate::events::GlobalInitialized;
use crate::state::{
    MarketGlobal, ALLOWED_MINTS_LEN, MAX_PROTOCOL_FEE_BPS, MAX_SOLREP_FEE_BPS,
};

#[derive(Accounts)]
pub struct InitGlobal<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + MarketGlobal::INIT_SPACE,
        seeds = [b"market_global"],
        bump,
    )]
    pub global: Account<'info, MarketGlobal>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<InitGlobal>,
    authority: Pubkey,
    agent_registry: Pubkey,
    treasury_standard: Pubkey,
    proof_verifier: Pubkey,
    fee_collector: Pubkey,
    solrep_pool: Pubkey,
    protocol_fee_bps: u16,
    solrep_fee_bps: u16,
    dispute_window_secs: i64,
    max_deadline_secs: i64,
    allowed_payment_mints: [Pubkey; ALLOWED_MINTS_LEN],
) -> Result<()> {
    require!(
        protocol_fee_bps <= MAX_PROTOCOL_FEE_BPS,
        TaskMarketError::FeeBoundExceeded
    );
    require!(
        solrep_fee_bps <= MAX_SOLREP_FEE_BPS,
        TaskMarketError::FeeBoundExceeded
    );
    require!(dispute_window_secs > 0, TaskMarketError::InvalidDeadline);
    require!(max_deadline_secs > 0, TaskMarketError::InvalidDeadline);

    let g = &mut ctx.accounts.global;
    g.authority = authority;
    g.pending_authority = None;
    g.agent_registry = agent_registry;
    g.treasury_standard = treasury_standard;
    g.proof_verifier = proof_verifier;
    g.fee_collector = fee_collector;
    g.solrep_pool = solrep_pool;
    g.protocol_fee_bps = protocol_fee_bps;
    g.solrep_fee_bps = solrep_fee_bps;
    g.dispute_window_secs = dispute_window_secs;
    g.max_deadline_secs = max_deadline_secs;
    g.allowed_payment_mints = allowed_payment_mints;
    g.paused = false;
    g.bump = ctx.bumps.global;
    g.hook_allowlist = Pubkey::default();

    emit!(GlobalInitialized {
        authority,
        agent_registry,
        proof_verifier,
        fee_collector,
        solrep_pool,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
