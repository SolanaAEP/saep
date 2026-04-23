use anchor_lang::prelude::*;

use crate::errors::TreasuryError;
use crate::events::{
    TreasuryYieldAccountingRecorded, TreasuryYieldConfigSet, TreasuryYieldUnwindRequested,
    YieldStrategyRegistered, YieldStrategyStatusSet,
};
use crate::state::{
    AgentTreasury, TreasuryGlobal, TreasuryYieldConfig, TreasuryYieldStatus, YieldRiskTier,
    YieldStrategyDescriptor, YieldStrategyStatus, YieldVenue, BPS_DENOM,
    MAX_YIELD_STRATEGY_NAME_LEN, MAX_YIELD_STRATEGY_URI_LEN,
};

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
