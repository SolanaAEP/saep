use anchor_lang::prelude::*;
use spl_token_2022::extension::{BaseStateWithExtensions, StateWithExtensions, transfer_hook::TransferHook};
use spl_token_2022::state::Mint as RawMint;

use crate::errors::AgentRegistryError;
use crate::events::GlobalInitialized;
use crate::state::{PersonhoodTier, RegistryGlobal, MAX_GATEKEEPER_NETWORKS, MAX_SLASH_BPS_CAP};

#[derive(Accounts)]
pub struct InitGlobal<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + RegistryGlobal::INIT_SPACE,
        seeds = [b"global"],
        bump,
    )]
    pub global: Account<'info, RegistryGlobal>,

    /// The stake mint account — validated to have no TransferHook extension.
    /// CHECK: owner validated manually; only read for extension inspection.
    pub stake_mint_info: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<InitGlobal>,
    authority: Pubkey,
    capability_registry: Pubkey,
    task_market: Pubkey,
    dispute_arbitration: Pubkey,
    slashing_treasury: Pubkey,
    stake_mint: Pubkey,
    proof_verifier: Pubkey,
    min_stake: u64,
    max_slash_bps: u16,
    slash_timelock_secs: i64,
) -> Result<()> {
    require!(max_slash_bps <= MAX_SLASH_BPS_CAP, AgentRegistryError::SlashCapTooHigh);
    require!(slash_timelock_secs > 0, AgentRegistryError::TimelockNotElapsed);

    // F-2026-17: reject stake mints with TransferHook extension at init time.
    // Stake transfers don't go through hook allowlist checks, so the mint must
    // be hook-free. SPL Token (legacy) mints have no extensions — always safe.
    let mint_info = &ctx.accounts.stake_mint_info;
    require!(mint_info.key() == stake_mint, AgentRegistryError::Unauthorized);
    if mint_info.owner == &anchor_spl::token_2022::ID {
        let data = mint_info.try_borrow_data()
            .map_err(|_| error!(AgentRegistryError::Unauthorized))?;
        let parsed = StateWithExtensions::<RawMint>::unpack(&data)
            .map_err(|_| error!(AgentRegistryError::Unauthorized))?;
        require!(
            parsed.get_extension::<TransferHook>().is_err(),
            AgentRegistryError::Unauthorized
        );
    }

    let g = &mut ctx.accounts.global;
    g.authority = authority;
    g.pending_authority = None;
    g.capability_registry = capability_registry;
    g.task_market = task_market;
    g.dispute_arbitration = dispute_arbitration;
    g.slashing_treasury = slashing_treasury;
    g.stake_mint = stake_mint;
    g.proof_verifier = proof_verifier;
    g.min_stake = min_stake;
    g.max_slash_bps = max_slash_bps;
    g.slash_timelock_secs = slash_timelock_secs;
    g.paused = false;
    g.allowed_civic_networks = [Pubkey::default(); MAX_GATEKEEPER_NETWORKS];
    g.allowed_civic_networks_len = 0;
    g.allowed_sas_issuers = [Pubkey::default(); MAX_GATEKEEPER_NETWORKS];
    g.allowed_sas_issuers_len = 0;
    g.personhood_basic_min_tier = PersonhoodTier::Basic;
    g.require_personhood_for_register = false;
    g.civic_gateway_program = Pubkey::default();
    g.bump = ctx.bumps.global;

    emit!(GlobalInitialized {
        authority,
        stake_mint,
        capability_registry,
        task_market,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
