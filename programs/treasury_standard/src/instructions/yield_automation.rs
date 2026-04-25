use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::errors::TreasuryError;
use crate::events::{
    TreasuryYieldAccountingRecorded, TreasuryYieldConfigSet, TreasuryYieldUnwindRequested,
    YieldStrategyDeposit, YieldStrategyEmergencyUnwind, YieldStrategyRegistered,
    YieldStrategyStatusSet, YieldStrategyWithdraw,
};
use crate::guard::{exit as guard_exit, try_enter, ReentrancyGuard, SEED_GUARD};
use crate::state::{
    apply_rollover, assert_call_target_allowed, checked_i64_add, checked_i64_delta,
    guard_oracle, max_yield_deployable_amount, normalize_to_base_units, read_oracle,
    AgentTreasury, AllowedMints, AllowedTargets, StrategyPosition, StrategyPositionStatus, TreasuryGlobal,
    TreasuryYieldConfig, TreasuryYieldStatus, YieldRiskTier, YieldStrategyDescriptor,
    YieldStrategyStatus, YieldVenue, BPS_DENOM, MAX_ROUTE_DATA_LEN, MAX_YIELD_STRATEGY_NAME_LEN,
    MAX_YIELD_STRATEGY_URI_LEN,
};
use crate::yield_cpi;

#[derive(Accounts)]
#[instruction(strategy_id: [u8; 32])]
pub struct RegisterYieldStrategy<'info> {
    #[account(
        seeds = [b"treasury_global"],
        bump = global.bump,
        has_one = authority @ TreasuryError::Unauthorized,
    )]
    pub global: Account<'info, TreasuryGlobal>,

    #[account(
        init,
        payer = authority,
        space = 8 + YieldStrategyDescriptor::INIT_SPACE,
        seeds = [b"yield_strategy", strategy_id.as_ref()],
        bump,
    )]
    pub strategy: Account<'info, YieldStrategyDescriptor>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetYieldStrategyStatus<'info> {
    #[account(
        seeds = [b"treasury_global"],
        bump = global.bump,
        has_one = authority @ TreasuryError::Unauthorized,
    )]
    pub global: Account<'info, TreasuryGlobal>,

    #[account(
        mut,
        seeds = [b"yield_strategy", strategy.strategy_id.as_ref()],
        bump = strategy.bump,
    )]
    pub strategy: Account<'info, YieldStrategyDescriptor>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(agent_did: [u8; 32], strategy_id: [u8; 32])]
pub struct SetTreasuryYieldConfig<'info> {
    #[account(seeds = [b"treasury_global"], bump = global.bump)]
    pub global: Account<'info, TreasuryGlobal>,

    #[account(
        seeds = [b"treasury", agent_did.as_ref()],
        bump = treasury.bump,
        has_one = operator @ TreasuryError::Unauthorized,
    )]
    pub treasury: Account<'info, AgentTreasury>,

    #[account(
        seeds = [b"yield_strategy", strategy_id.as_ref()],
        bump = strategy.bump,
    )]
    pub strategy: Account<'info, YieldStrategyDescriptor>,

    #[account(
        init_if_needed,
        payer = operator,
        space = 8 + TreasuryYieldConfig::INIT_SPACE,
        seeds = [b"yield_config", agent_did.as_ref()],
        bump,
    )]
    pub yield_config: Account<'info, TreasuryYieldConfig>,

    #[account(mut)]
    pub operator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestTreasuryYieldUnwind<'info> {
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
        seeds = [b"yield_config", treasury.agent_did.as_ref()],
        bump = yield_config.bump,
    )]
    pub yield_config: Account<'info, TreasuryYieldConfig>,

    pub operator: Signer<'info>,
}

#[derive(Accounts)]
pub struct RecordTreasuryYieldAccounting<'info> {
    #[account(
        seeds = [b"treasury_global"],
        bump = global.bump,
        has_one = authority @ TreasuryError::Unauthorized,
    )]
    pub global: Account<'info, TreasuryGlobal>,

    #[account(
        mut,
        seeds = [b"yield_config", yield_config.agent_did.as_ref()],
        bump = yield_config.bump,
    )]
    pub yield_config: Account<'info, TreasuryYieldConfig>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct DepositToYieldStrategy<'info> {
    #[account(seeds = [b"treasury_global"], bump = global.bump)]
    pub global: Box<Account<'info, TreasuryGlobal>>,

    #[account(
        mut,
        seeds = [b"treasury", treasury.agent_did.as_ref()],
        bump = treasury.bump,
        has_one = operator @ TreasuryError::Unauthorized,
    )]
    pub treasury: Box<Account<'info, AgentTreasury>>,

    #[account(
        seeds = [b"allowed_mints"],
        bump = allowed_mints.bump,
        address = global.allowed_mints,
    )]
    pub allowed_mints: Box<Account<'info, AllowedMints>>,

    #[account(
        seeds = [b"allowed_targets", treasury.agent_did.as_ref()],
        bump = allowed_targets.bump,
    )]
    pub allowed_targets: Option<Account<'info, AllowedTargets>>,

    #[account(
        seeds = [b"yield_strategy", strategy.strategy_id.as_ref()],
        bump = strategy.bump,
    )]
    pub strategy: Box<Account<'info, YieldStrategyDescriptor>>,

    #[account(
        mut,
        seeds = [b"yield_config", treasury.agent_did.as_ref()],
        bump = yield_config.bump,
    )]
    pub yield_config: Box<Account<'info, TreasuryYieldConfig>>,

    #[account(
        init_if_needed,
        payer = operator,
        space = 8 + StrategyPosition::INIT_SPACE,
        seeds = [
            b"yield_position",
            treasury.agent_did.as_ref(),
            strategy.strategy_id.as_ref(),
            mint.key().as_ref()
        ],
        bump,
    )]
    pub position: Box<Account<'info, StrategyPosition>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,
    pub receipt_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [b"vault", treasury.agent_did.as_ref(), mint.key().as_ref()],
        bump,
        token::mint = mint,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = operator,
        seeds = [b"yield_receipt_vault", position.key().as_ref()],
        bump,
        token::mint = receipt_mint,
        token::authority = receipt_vault,
        token::token_program = token_program,
    )]
    pub receipt_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: governance-registered Kamino program; key and executable bit are validated.
    pub kamino_program: UncheckedAccount<'info>,

    /// CHECK: optional Pyth PriceUpdateV2 for non-6-decimal spend normalization.
    pub price_feed: Option<UncheckedAccount<'info>>,

    #[account(mut, seeds = [SEED_GUARD], bump = guard.bump)]
    pub guard: Box<Account<'info, ReentrancyGuard>>,

    #[account(mut)]
    pub operator: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct WithdrawFromYieldStrategy<'info> {
    #[account(seeds = [b"treasury_global"], bump = global.bump)]
    pub global: Box<Account<'info, TreasuryGlobal>>,

    #[account(
        mut,
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
        seeds = [b"yield_strategy", strategy.strategy_id.as_ref()],
        bump = strategy.bump,
    )]
    pub strategy: Box<Account<'info, YieldStrategyDescriptor>>,

    #[account(
        mut,
        seeds = [b"yield_config", treasury.agent_did.as_ref()],
        bump = yield_config.bump,
    )]
    pub yield_config: Box<Account<'info, TreasuryYieldConfig>>,

    #[account(
        mut,
        seeds = [
            b"yield_position",
            treasury.agent_did.as_ref(),
            strategy.strategy_id.as_ref(),
            mint.key().as_ref()
        ],
        bump = position.bump,
    )]
    pub position: Box<Account<'info, StrategyPosition>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,
    pub receipt_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [b"vault", treasury.agent_did.as_ref(), mint.key().as_ref()],
        bump,
        token::mint = mint,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"yield_receipt_vault", position.key().as_ref()],
        bump,
        token::mint = receipt_mint,
        token::authority = receipt_vault,
        token::token_program = token_program,
    )]
    pub receipt_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: governance-registered Kamino program; key and executable bit are validated.
    pub kamino_program: UncheckedAccount<'info>,

    #[account(mut, seeds = [SEED_GUARD], bump = guard.bump)]
    pub guard: Box<Account<'info, ReentrancyGuard>>,

    pub operator: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct EmergencyUnwindYieldStrategy<'info> {
    #[account(
        seeds = [b"treasury_global"],
        bump = global.bump,
        has_one = authority @ TreasuryError::Unauthorized,
    )]
    pub global: Box<Account<'info, TreasuryGlobal>>,

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
        seeds = [b"yield_strategy", strategy.strategy_id.as_ref()],
        bump = strategy.bump,
    )]
    pub strategy: Box<Account<'info, YieldStrategyDescriptor>>,

    #[account(
        mut,
        seeds = [b"yield_config", treasury.agent_did.as_ref()],
        bump = yield_config.bump,
    )]
    pub yield_config: Box<Account<'info, TreasuryYieldConfig>>,

    #[account(
        mut,
        seeds = [
            b"yield_position",
            treasury.agent_did.as_ref(),
            strategy.strategy_id.as_ref(),
            mint.key().as_ref()
        ],
        bump = position.bump,
    )]
    pub position: Box<Account<'info, StrategyPosition>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,
    pub receipt_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [b"vault", treasury.agent_did.as_ref(), mint.key().as_ref()],
        bump,
        token::mint = mint,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"yield_receipt_vault", position.key().as_ref()],
        bump,
        token::mint = receipt_mint,
        token::authority = receipt_vault,
        token::token_program = token_program,
    )]
    pub receipt_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: governance-registered Kamino program; key and executable bit are validated.
    pub kamino_program: UncheckedAccount<'info>,

    #[account(mut, seeds = [SEED_GUARD], bump = guard.bump)]
    pub guard: Box<Account<'info, ReentrancyGuard>>,

    pub authority: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn register_strategy_handler(
    ctx: Context<RegisterYieldStrategy>,
    strategy_id: [u8; 32],
    venue: YieldVenue,
    strategy_program: Pubkey,
    underlying_mint: Pubkey,
    receipt_mint: Pubkey,
    max_allocation_bps: u16,
    risk_tier: YieldRiskTier,
    name: String,
    metadata_uri: String,
) -> Result<()> {
    require!(!ctx.accounts.global.paused, TreasuryError::Paused);
    require!(
        name.len() <= MAX_YIELD_STRATEGY_NAME_LEN,
        TreasuryError::YieldNameTooLong
    );
    require!(
        metadata_uri.len() <= MAX_YIELD_STRATEGY_URI_LEN,
        TreasuryError::YieldUriTooLong
    );
    require!(
        u64::from(max_allocation_bps) <= BPS_DENOM,
        TreasuryError::YieldAllocationInvalid
    );
    require!(
        strategy_program != Pubkey::default(),
        TreasuryError::InvalidCallTarget
    );
    require!(
        underlying_mint != Pubkey::default() && receipt_mint != Pubkey::default(),
        TreasuryError::MintNotAllowed
    );

    let now = Clock::get()?.unix_timestamp;
    let strategy = &mut ctx.accounts.strategy;
    strategy.strategy_id = strategy_id;
    strategy.venue = venue;
    strategy.strategy_program = strategy_program;
    strategy.underlying_mint = underlying_mint;
    strategy.receipt_mint = receipt_mint;
    strategy.max_allocation_bps = max_allocation_bps;
    strategy.risk_tier = risk_tier;
    strategy.status = YieldStrategyStatus::Active;
    strategy.name = name.clone();
    strategy.metadata_uri = metadata_uri.clone();
    strategy.created_at = now;
    strategy.updated_at = now;
    strategy.bump = ctx.bumps.strategy;

    emit!(YieldStrategyRegistered {
        strategy_id,
        venue: venue_label(venue).to_string(),
        strategy_program,
        underlying_mint,
        receipt_mint,
        max_allocation_bps,
        risk_tier: risk_tier_label(risk_tier).to_string(),
        status: strategy_status_label(YieldStrategyStatus::Active).to_string(),
        name,
        metadata_uri,
        timestamp: now,
    });
    Ok(())
}

pub fn set_strategy_status_handler(
    ctx: Context<SetYieldStrategyStatus>,
    status: YieldStrategyStatus,
) -> Result<()> {
    require!(!ctx.accounts.global.paused, TreasuryError::Paused);
    let now = Clock::get()?.unix_timestamp;
    let strategy = &mut ctx.accounts.strategy;
    strategy.status = status;
    strategy.updated_at = now;

    emit!(YieldStrategyStatusSet {
        strategy_id: strategy.strategy_id,
        status: strategy_status_label(status).to_string(),
        timestamp: now,
    });
    Ok(())
}

pub fn set_treasury_config_handler(
    ctx: Context<SetTreasuryYieldConfig>,
    agent_did: [u8; 32],
    strategy_id: [u8; 32],
    allocation_bps: u16,
    paused: bool,
) -> Result<()> {
    require!(!ctx.accounts.global.paused, TreasuryError::Paused);
    require!(
        ctx.accounts.treasury.agent_did == agent_did,
        TreasuryError::AgentMismatch
    );
    require!(
        ctx.accounts.strategy.strategy_id == strategy_id,
        TreasuryError::YieldStrategyNotActive
    );
    require!(
        ctx.accounts.strategy.status == YieldStrategyStatus::Active,
        TreasuryError::YieldStrategyNotActive
    );
    require!(
        u64::from(allocation_bps) <= BPS_DENOM,
        TreasuryError::YieldAllocationInvalid
    );
    require!(
        allocation_bps <= ctx.accounts.strategy.max_allocation_bps,
        TreasuryError::YieldAllocationExceeded
    );

    let now = Clock::get()?.unix_timestamp;
    let status = if paused {
        TreasuryYieldStatus::Paused
    } else if allocation_bps == 0 {
        TreasuryYieldStatus::Inactive
    } else {
        TreasuryYieldStatus::Active
    };
    let config = &mut ctx.accounts.yield_config;
    if config.created_at == 0 {
        config.created_at = now;
    }
    config.agent_did = agent_did;
    config.strategy_id = strategy_id;
    config.allocation_bps = allocation_bps;
    config.status = status;
    config.unwind_requested = false;
    config.updated_at = now;
    config.bump = ctx.bumps.yield_config;

    emit!(TreasuryYieldConfigSet {
        agent_did,
        strategy_id,
        allocation_bps,
        status: treasury_yield_status_label(status).to_string(),
        timestamp: now,
    });
    Ok(())
}

pub fn request_unwind_handler(ctx: Context<RequestTreasuryYieldUnwind>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.yield_config;
    require!(
        config.status == TreasuryYieldStatus::Active
            || config.status == TreasuryYieldStatus::Paused,
        TreasuryError::TreasuryYieldNotActive
    );
    config.status = TreasuryYieldStatus::Unwinding;
    config.unwind_requested = true;
    config.updated_at = now;

    emit!(TreasuryYieldUnwindRequested {
        agent_did: config.agent_did,
        strategy_id: config.strategy_id,
        timestamp: now,
    });
    Ok(())
}

pub fn record_accounting_handler(
    ctx: Context<RecordTreasuryYieldAccounting>,
    idle_amount: u64,
    deployed_amount: u64,
    realized_yield_amount: i64,
    accounting_slot: u64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.yield_config;
    require!(
        accounting_slot >= config.last_accounting_slot,
        TreasuryError::YieldAccountingStale
    );
    config.idle_amount = idle_amount;
    config.deployed_amount = deployed_amount;
    config.realized_yield_amount = realized_yield_amount;
    config.last_accounting_slot = accounting_slot;
    config.updated_at = now;

    emit!(TreasuryYieldAccountingRecorded {
        agent_did: config.agent_did,
        strategy_id: config.strategy_id,
        idle_amount,
        deployed_amount,
        realized_yield_amount,
        accounting_slot,
        status: treasury_yield_status_label(config.status).to_string(),
        timestamp: now,
    });
    Ok(())
}

pub fn deposit_to_strategy_handler<'a>(
    ctx: Context<'a, DepositToYieldStrategy<'a>>,
    amount: u64,
    route_data: Vec<u8>,
) -> Result<()> {
    let clock = Clock::get()?;
    try_enter(&mut ctx.accounts.guard, crate::ID, clock.slot)?;

    require!(!ctx.accounts.global.paused, TreasuryError::Paused);
    require!(amount > 0, TreasuryError::ZeroAmount);
    require!(!route_data.is_empty(), TreasuryError::YieldRouteRequired);
    require!(
        route_data.len() <= MAX_ROUTE_DATA_LEN,
        TreasuryError::RouteDataTooLong
    );
    validate_kamino_strategy(
        &ctx.accounts.strategy,
        &ctx.accounts.kamino_program,
        &ctx.accounts.mint,
        &ctx.accounts.receipt_mint,
    )?;
    require!(
        ctx.accounts.strategy.status == YieldStrategyStatus::Active,
        TreasuryError::YieldStrategyNotActive
    );
    require!(
        ctx.accounts.yield_config.status == TreasuryYieldStatus::Active
            && !ctx.accounts.yield_config.unwind_requested,
        TreasuryError::TreasuryYieldNotActive
    );
    require!(
        ctx.accounts.yield_config.strategy_id == ctx.accounts.strategy.strategy_id,
        TreasuryError::YieldStrategyNotActive
    );
    require!(
        ctx.accounts.position.status != StrategyPositionStatus::Closed,
        TreasuryError::YieldPositionClosed
    );

    let now = clock.unix_timestamp;
    let agent_did = ctx.accounts.treasury.agent_did;
    let strategy_id = ctx.accounts.strategy.strategy_id;
    let mint_key = ctx.accounts.mint.key();
    let receipt_mint_key = ctx.accounts.receipt_mint.key();
    require!(
        ctx.accounts.allowed_mints.mints.iter().any(|m| m == &mint_key),
        TreasuryError::MintNotAllowed
    );

    if ctx.accounts.position.created_at == 0 {
        let p = &mut ctx.accounts.position;
        p.agent_did = agent_did;
        p.strategy_id = strategy_id;
        p.vault_mint = mint_key;
        p.receipt_mint = receipt_mint_key;
        p.status = StrategyPositionStatus::Active;
        p.created_at = now;
        p.bump = ctx.bumps.position;
    } else {
        validate_position(
            &ctx.accounts.position,
            agent_did,
            strategy_id,
            mint_key,
            receipt_mint_key,
        )?;
    }

    apply_rollover(&mut ctx.accounts.treasury, now);
    let normalized = normalize_yield_amount(
        amount,
        ctx.accounts.mint.decimals,
        ctx.accounts.price_feed.as_ref(),
        &clock,
    )?;
    enforce_treasury_spend_limits(&mut ctx.accounts.treasury, normalized)?;

    let max_deployed = max_yield_deployable_amount(
        ctx.accounts.vault.amount,
        ctx.accounts.yield_config.deployed_amount,
        ctx.accounts.yield_config.allocation_bps,
    )?;
    let projected_deployed = ctx
        .accounts
        .yield_config
        .deployed_amount
        .checked_add(amount)
        .ok_or(TreasuryError::ArithmeticOverflow)?;
    require!(
        projected_deployed <= max_deployed
            && ctx.accounts.yield_config.allocation_bps
                <= ctx.accounts.strategy.max_allocation_bps,
        TreasuryError::YieldAllocationExceeded
    );
    require!(
        ctx.accounts.vault.amount >= amount,
        TreasuryError::InsufficientVault
    );

    let kamino_key = ctx.accounts.kamino_program.key();
    assert_call_target_allowed(
        &ctx.accounts.global,
        ctx.accounts.allowed_targets.as_deref(),
        &kamino_key,
    )?;

    let vault_bump = ctx.bumps.vault;
    let vault_seeds: &[&[u8]] = &[
        b"vault",
        agent_did.as_ref(),
        mint_key.as_ref(),
        core::slice::from_ref(&vault_bump),
    ];
    let signer = &[vault_seeds];
    let vault_key = ctx.accounts.vault.key();

    let vault_before = ctx.accounts.vault.amount;
    let receipt_before = ctx.accounts.receipt_vault.amount;
    yield_cpi::execute_route(
        &ctx.accounts.kamino_program.to_account_info(),
        ctx.remaining_accounts,
        route_data,
        signer,
        &[vault_key],
    )?;

    ctx.accounts.vault.reload()?;
    ctx.accounts.receipt_vault.reload()?;

    let principal_delta = vault_before
        .checked_sub(ctx.accounts.vault.amount)
        .ok_or(TreasuryError::ArithmeticOverflow)?;
    require!(principal_delta > 0, TreasuryError::YieldNoBalanceDelta);
    require!(
        principal_delta <= amount,
        TreasuryError::YieldDepositAmountExceeded
    );
    let receipt_delta = ctx
        .accounts
        .receipt_vault
        .amount
        .checked_sub(receipt_before)
        .ok_or(TreasuryError::ArithmeticOverflow)?;
    require!(receipt_delta > 0, TreasuryError::YieldNoBalanceDelta);

    let position = &mut ctx.accounts.position;
    position.principal_amount = position
        .principal_amount
        .checked_add(principal_delta)
        .ok_or(TreasuryError::ArithmeticOverflow)?;
    position.receipt_amount = position
        .receipt_amount
        .checked_add(receipt_delta)
        .ok_or(TreasuryError::ArithmeticOverflow)?;
    position.last_accounting_slot = clock.slot;
    position.status = StrategyPositionStatus::Active;
    position.unwind_requested = false;
    position.updated_at = now;

    let config = &mut ctx.accounts.yield_config;
    config.idle_amount = ctx.accounts.vault.amount;
    config.deployed_amount = config
        .deployed_amount
        .checked_add(principal_delta)
        .ok_or(TreasuryError::ArithmeticOverflow)?;
    config.last_accounting_slot = clock.slot;
    config.updated_at = now;

    emit!(YieldStrategyDeposit {
        agent_did,
        strategy_id,
        vault_mint: mint_key,
        receipt_mint: receipt_mint_key,
        principal_delta,
        receipt_delta,
        principal_amount: position.principal_amount,
        receipt_amount: position.receipt_amount,
        realized_yield_amount: position.realized_yield_amount,
        deployed_amount: config.deployed_amount,
        idle_amount: config.idle_amount,
        accounting_slot: clock.slot,
        status: position_status_label(position.status).to_string(),
        timestamp: now,
    });
    emit_accounting(config, now);

    guard_exit(&mut ctx.accounts.guard);
    Ok(())
}

pub fn withdraw_from_strategy_handler<'a>(
    ctx: Context<'a, WithdrawFromYieldStrategy<'a>>,
    receipt_amount: u64,
    route_data: Vec<u8>,
) -> Result<()> {
    let clock = Clock::get()?;
    try_enter(&mut ctx.accounts.guard, crate::ID, clock.slot)?;

    require!(!ctx.accounts.global.paused, TreasuryError::Paused);
    require!(receipt_amount > 0, TreasuryError::ZeroAmount);
    require!(!route_data.is_empty(), TreasuryError::YieldRouteRequired);
    require!(
        route_data.len() <= MAX_ROUTE_DATA_LEN,
        TreasuryError::RouteDataTooLong
    );
    validate_kamino_strategy(
        &ctx.accounts.strategy,
        &ctx.accounts.kamino_program,
        &ctx.accounts.mint,
        &ctx.accounts.receipt_mint,
    )?;
    validate_position(
        &ctx.accounts.position,
        ctx.accounts.treasury.agent_did,
        ctx.accounts.strategy.strategy_id,
        ctx.accounts.mint.key(),
        ctx.accounts.receipt_mint.key(),
    )?;
    require!(
        ctx.accounts.position.status != StrategyPositionStatus::Closed,
        TreasuryError::YieldPositionClosed
    );
    require!(
        ctx.accounts.yield_config.status == TreasuryYieldStatus::Active
            || ctx.accounts.yield_config.status == TreasuryYieldStatus::Paused
            || ctx.accounts.yield_config.status == TreasuryYieldStatus::Unwinding,
        TreasuryError::TreasuryYieldNotActive
    );
    require!(
        ctx.accounts.yield_config.strategy_id == ctx.accounts.strategy.strategy_id,
        TreasuryError::YieldStrategyNotActive
    );
    require!(
        ctx.accounts.receipt_vault.amount >= receipt_amount,
        TreasuryError::InsufficientVault
    );

    let kamino_key = ctx.accounts.kamino_program.key();
    assert_call_target_allowed(
        &ctx.accounts.global,
        ctx.accounts.allowed_targets.as_deref(),
        &kamino_key,
    )?;

    let now = clock.unix_timestamp;
    let agent_did = ctx.accounts.treasury.agent_did;
    let strategy_id = ctx.accounts.strategy.strategy_id;
    let mint_key = ctx.accounts.mint.key();
    let receipt_mint_key = ctx.accounts.receipt_mint.key();
    let position_key = ctx.accounts.position.key();
    let receipt_vault_key = ctx.accounts.receipt_vault.key();
    let receipt_vault_bump = ctx.bumps.receipt_vault;
    let receipt_vault_seeds: &[&[u8]] = &[
        b"yield_receipt_vault",
        position_key.as_ref(),
        core::slice::from_ref(&receipt_vault_bump),
    ];
    let signer = &[receipt_vault_seeds];

    let receipt_before = ctx.accounts.receipt_vault.amount;
    let vault_before = ctx.accounts.vault.amount;
    yield_cpi::execute_route(
        &ctx.accounts.kamino_program.to_account_info(),
        ctx.remaining_accounts,
        route_data,
        signer,
        &[receipt_vault_key],
    )?;

    ctx.accounts.receipt_vault.reload()?;
    ctx.accounts.vault.reload()?;

    let receipt_delta = receipt_before
        .checked_sub(ctx.accounts.receipt_vault.amount)
        .ok_or(TreasuryError::ArithmeticOverflow)?;
    require!(receipt_delta > 0, TreasuryError::YieldNoBalanceDelta);
    require!(
        receipt_delta <= receipt_amount,
        TreasuryError::YieldWithdrawAmountExceeded
    );
    let amount_received = ctx
        .accounts
        .vault
        .amount
        .checked_sub(vault_before)
        .ok_or(TreasuryError::ArithmeticOverflow)?;
    require!(amount_received > 0, TreasuryError::YieldNoBalanceDelta);

    let (principal_reduced, realized_yield_delta) = apply_withdraw_accounting(
        &mut ctx.accounts.position,
        &mut ctx.accounts.yield_config,
        amount_received,
        receipt_delta,
        ctx.accounts.vault.amount,
        clock.slot,
        now,
        false,
    )?;

    emit!(YieldStrategyWithdraw {
        agent_did,
        strategy_id,
        vault_mint: mint_key,
        receipt_mint: receipt_mint_key,
        principal_reduced,
        receipt_delta,
        amount_received,
        realized_yield_delta,
        principal_amount: ctx.accounts.position.principal_amount,
        receipt_amount: ctx.accounts.position.receipt_amount,
        realized_yield_amount: ctx.accounts.position.realized_yield_amount,
        deployed_amount: ctx.accounts.yield_config.deployed_amount,
        idle_amount: ctx.accounts.yield_config.idle_amount,
        accounting_slot: clock.slot,
        status: position_status_label(ctx.accounts.position.status).to_string(),
        timestamp: now,
    });
    emit_accounting(&ctx.accounts.yield_config, now);

    guard_exit(&mut ctx.accounts.guard);
    Ok(())
}

pub fn emergency_unwind_strategy_handler<'a>(
    ctx: Context<'a, EmergencyUnwindYieldStrategy<'a>>,
    route_data: Vec<u8>,
) -> Result<()> {
    let clock = Clock::get()?;
    try_enter(&mut ctx.accounts.guard, crate::ID, clock.slot)?;

    require!(!route_data.is_empty(), TreasuryError::YieldRouteRequired);
    require!(
        route_data.len() <= MAX_ROUTE_DATA_LEN,
        TreasuryError::RouteDataTooLong
    );
    validate_kamino_strategy(
        &ctx.accounts.strategy,
        &ctx.accounts.kamino_program,
        &ctx.accounts.mint,
        &ctx.accounts.receipt_mint,
    )?;
    validate_position(
        &ctx.accounts.position,
        ctx.accounts.treasury.agent_did,
        ctx.accounts.strategy.strategy_id,
        ctx.accounts.mint.key(),
        ctx.accounts.receipt_mint.key(),
    )?;
    require!(
        ctx.accounts.position.status != StrategyPositionStatus::Closed,
        TreasuryError::YieldPositionClosed
    );
    require!(
        ctx.accounts.receipt_vault.amount > 0,
        TreasuryError::ZeroAmount
    );

    let kamino_key = ctx.accounts.kamino_program.key();
    assert_call_target_allowed(
        &ctx.accounts.global,
        ctx.accounts.allowed_targets.as_deref(),
        &kamino_key,
    )?;

    let now = clock.unix_timestamp;
    let agent_did = ctx.accounts.treasury.agent_did;
    let strategy_id = ctx.accounts.strategy.strategy_id;
    let mint_key = ctx.accounts.mint.key();
    let receipt_mint_key = ctx.accounts.receipt_mint.key();
    let position_key = ctx.accounts.position.key();
    let receipt_vault_key = ctx.accounts.receipt_vault.key();
    let receipt_vault_bump = ctx.bumps.receipt_vault;
    let receipt_vault_seeds: &[&[u8]] = &[
        b"yield_receipt_vault",
        position_key.as_ref(),
        core::slice::from_ref(&receipt_vault_bump),
    ];
    let signer = &[receipt_vault_seeds];

    let receipt_before = ctx.accounts.receipt_vault.amount;
    let vault_before = ctx.accounts.vault.amount;
    yield_cpi::execute_route(
        &ctx.accounts.kamino_program.to_account_info(),
        ctx.remaining_accounts,
        route_data,
        signer,
        &[receipt_vault_key],
    )?;

    ctx.accounts.receipt_vault.reload()?;
    ctx.accounts.vault.reload()?;

    let receipt_delta = receipt_before
        .checked_sub(ctx.accounts.receipt_vault.amount)
        .ok_or(TreasuryError::ArithmeticOverflow)?;
    require!(receipt_delta > 0, TreasuryError::YieldNoBalanceDelta);
    require!(
        ctx.accounts.receipt_vault.amount == 0,
        TreasuryError::YieldUnwindIncomplete
    );
    let amount_received = ctx
        .accounts
        .vault
        .amount
        .checked_sub(vault_before)
        .ok_or(TreasuryError::ArithmeticOverflow)?;
    require!(amount_received > 0, TreasuryError::YieldNoBalanceDelta);

    let (principal_reduced, realized_yield_delta) = apply_withdraw_accounting(
        &mut ctx.accounts.position,
        &mut ctx.accounts.yield_config,
        amount_received,
        receipt_delta,
        ctx.accounts.vault.amount,
        clock.slot,
        now,
        true,
    )?;
    ctx.accounts.yield_config.unwind_requested = true;
    ctx.accounts.yield_config.status = TreasuryYieldStatus::Inactive;
    ctx.accounts.yield_config.updated_at = now;

    emit!(YieldStrategyEmergencyUnwind {
        agent_did,
        strategy_id,
        vault_mint: mint_key,
        receipt_mint: receipt_mint_key,
        principal_reduced,
        receipt_delta,
        amount_received,
        realized_yield_delta,
        principal_amount: ctx.accounts.position.principal_amount,
        receipt_amount: ctx.accounts.position.receipt_amount,
        realized_yield_amount: ctx.accounts.position.realized_yield_amount,
        deployed_amount: ctx.accounts.yield_config.deployed_amount,
        idle_amount: ctx.accounts.yield_config.idle_amount,
        accounting_slot: clock.slot,
        status: position_status_label(ctx.accounts.position.status).to_string(),
        timestamp: now,
    });
    emit_accounting(&ctx.accounts.yield_config, now);

    guard_exit(&mut ctx.accounts.guard);
    Ok(())
}

fn validate_kamino_strategy(
    strategy: &YieldStrategyDescriptor,
    kamino_program: &UncheckedAccount,
    mint: &InterfaceAccount<Mint>,
    receipt_mint: &InterfaceAccount<Mint>,
) -> Result<()> {
    require!(
        strategy.venue == YieldVenue::Kamino,
        TreasuryError::UnsupportedYieldVenue
    );
    require!(
        kamino_program.key() == strategy.strategy_program && kamino_program.executable,
        TreasuryError::InvalidYieldProgram
    );
    require!(
        mint.key() == strategy.underlying_mint,
        TreasuryError::YieldMintMismatch
    );
    require!(
        receipt_mint.key() == strategy.receipt_mint,
        TreasuryError::YieldReceiptMintMismatch
    );
    Ok(())
}

fn validate_position(
    position: &StrategyPosition,
    agent_did: [u8; 32],
    strategy_id: [u8; 32],
    vault_mint: Pubkey,
    receipt_mint: Pubkey,
) -> Result<()> {
    require!(position.agent_did == agent_did, TreasuryError::AgentMismatch);
    require!(
        position.strategy_id == strategy_id,
        TreasuryError::YieldStrategyNotActive
    );
    require!(
        position.vault_mint == vault_mint,
        TreasuryError::YieldMintMismatch
    );
    require!(
        position.receipt_mint == receipt_mint,
        TreasuryError::YieldReceiptMintMismatch
    );
    Ok(())
}

fn normalize_yield_amount(
    amount: u64,
    decimals: u8,
    price_feed: Option<&UncheckedAccount>,
    clock: &Clock,
) -> Result<u64> {
    match price_feed {
        Some(feed) => {
            let oracle = read_oracle(&feed.to_account_info(), clock)?;
            guard_oracle(&oracle)?;
            normalize_to_base_units(amount, &oracle, decimals)
        }
        None => Ok(amount),
    }
}

fn enforce_treasury_spend_limits(treasury: &mut AgentTreasury, normalized: u64) -> Result<()> {
    require!(
        normalized <= treasury.per_tx_limit,
        TreasuryError::LimitExceeded
    );
    let new_daily = treasury
        .spent_today
        .checked_add(normalized)
        .ok_or(TreasuryError::ArithmeticOverflow)?;
    require!(
        new_daily <= treasury.daily_spend_limit,
        TreasuryError::LimitExceeded
    );
    let new_weekly = treasury
        .spent_this_week
        .checked_add(normalized)
        .ok_or(TreasuryError::ArithmeticOverflow)?;
    require!(new_weekly <= treasury.weekly_limit, TreasuryError::LimitExceeded);
    treasury.spent_today = new_daily;
    treasury.spent_this_week = new_weekly;
    Ok(())
}

fn apply_withdraw_accounting(
    position: &mut StrategyPosition,
    config: &mut TreasuryYieldConfig,
    amount_received: u64,
    receipt_delta: u64,
    idle_vault_amount: u64,
    accounting_slot: u64,
    now: i64,
    complete_unwind: bool,
) -> Result<(u64, i64)> {
    require!(
        receipt_delta <= position.receipt_amount,
        TreasuryError::YieldWithdrawAmountExceeded
    );
    let principal_before = position.principal_amount;
    let receipt_after = position
        .receipt_amount
        .checked_sub(receipt_delta)
        .ok_or(TreasuryError::ArithmeticOverflow)?;
    let principal_reduced = if complete_unwind || receipt_after == 0 {
        principal_before
    } else {
        principal_before.min(receipt_delta)
    };
    let realized_yield_delta = checked_i64_delta(amount_received, principal_reduced)?;

    position.principal_amount = principal_before
        .checked_sub(principal_reduced)
        .ok_or(TreasuryError::ArithmeticOverflow)?;
    position.receipt_amount = receipt_after;
    position.realized_yield_amount =
        checked_i64_add(position.realized_yield_amount, realized_yield_delta)?;
    position.last_accounting_slot = accounting_slot;
    position.updated_at = now;
    position.status = if position.receipt_amount == 0 {
        StrategyPositionStatus::Closed
    } else if complete_unwind || config.unwind_requested {
        StrategyPositionStatus::Unwinding
    } else {
        StrategyPositionStatus::Active
    };
    position.unwind_requested = complete_unwind || config.unwind_requested;

    let deployed_reduction = config.deployed_amount.min(principal_reduced);
    config.deployed_amount = config
        .deployed_amount
        .checked_sub(deployed_reduction)
        .ok_or(TreasuryError::ArithmeticOverflow)?;
    config.idle_amount = idle_vault_amount;
    config.realized_yield_amount =
        checked_i64_add(config.realized_yield_amount, realized_yield_delta)?;
    config.last_accounting_slot = accounting_slot;
    config.updated_at = now;

    Ok((principal_reduced, realized_yield_delta))
}

fn emit_accounting(config: &TreasuryYieldConfig, now: i64) {
    emit!(TreasuryYieldAccountingRecorded {
        agent_did: config.agent_did,
        strategy_id: config.strategy_id,
        idle_amount: config.idle_amount,
        deployed_amount: config.deployed_amount,
        realized_yield_amount: config.realized_yield_amount,
        accounting_slot: config.last_accounting_slot,
        status: treasury_yield_status_label(config.status).to_string(),
        timestamp: now,
    });
}

fn venue_label(value: YieldVenue) -> &'static str {
    match value {
        YieldVenue::Kamino => "kamino",
        YieldVenue::Marginfi => "marginfi",
        YieldVenue::Drift => "drift",
    }
}

fn risk_tier_label(value: YieldRiskTier) -> &'static str {
    match value {
        YieldRiskTier::Conservative => "conservative",
        YieldRiskTier::Moderate => "moderate",
        YieldRiskTier::Aggressive => "aggressive",
    }
}

fn strategy_status_label(value: YieldStrategyStatus) -> &'static str {
    match value {
        YieldStrategyStatus::Active => "active",
        YieldStrategyStatus::Paused => "paused",
        YieldStrategyStatus::Revoked => "revoked",
    }
}

fn treasury_yield_status_label(value: TreasuryYieldStatus) -> &'static str {
    match value {
        TreasuryYieldStatus::Inactive => "inactive",
        TreasuryYieldStatus::Active => "active",
        TreasuryYieldStatus::Paused => "paused",
        TreasuryYieldStatus::Unwinding => "unwinding",
    }
}

fn position_status_label(value: StrategyPositionStatus) -> &'static str {
    match value {
        StrategyPositionStatus::Active => "active",
        StrategyPositionStatus::Unwinding => "unwinding",
        StrategyPositionStatus::Closed => "closed",
    }
}
