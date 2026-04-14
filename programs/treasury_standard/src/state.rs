use anchor_lang::prelude::*;

use crate::errors::TreasuryError;

pub const MAX_ALLOWED_MINTS: usize = 16;
pub const SECS_PER_DAY: i64 = 86_400;
pub const SECS_PER_WEEK: i64 = 604_800;
pub const DEFAULT_MAX_STREAM_DURATION: i64 = 30 * SECS_PER_DAY;

pub const MAX_STALENESS_SECS: i64 = 60;
pub const MAX_CONFIDENCE_BPS: u64 = 100;
pub const DEFAULT_SLIPPAGE_BPS: u64 = 50;
pub const BPS_DENOM: u64 = 10_000;

#[account]
#[derive(InitSpace)]
pub struct TreasuryGlobal {
    pub authority: Pubkey,
    pub pending_authority: Option<Pubkey>,
    pub agent_registry: Pubkey,
    pub jupiter_program: Pubkey,
    pub allowed_mints: Pubkey,
    pub max_stream_duration: i64,
    pub default_daily_limit: u64,
    pub max_daily_limit: u64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AgentTreasury {
    pub agent_did: [u8; 32],
    pub operator: Pubkey,
    pub daily_spend_limit: u64,
    pub per_tx_limit: u64,
    pub weekly_limit: u64,
    pub spent_today: u64,
    pub spent_this_week: u64,
    pub last_reset_day: i64,
    pub last_reset_week: i64,
    pub streaming_active: bool,
    pub stream_counterparty: Option<Pubkey>,
    pub stream_rate_per_sec: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum StreamStatus {
    Active,
    Closed,
}

#[account]
#[derive(InitSpace)]
pub struct PaymentStream {
    pub agent_did: [u8; 32],
    pub client: Pubkey,
    pub payer_mint: Pubkey,
    pub payout_mint: Pubkey,
    pub rate_per_sec: u64,
    pub start_time: i64,
    pub max_duration: i64,
    pub deposit_total: u64,
    pub withdrawn: u64,
    pub escrow_bump: u8,
    pub status: StreamStatus,
    pub stream_nonce: [u8; 8],
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AllowedMints {
    pub authority: Pubkey,
    #[max_len(16)]
    pub mints: Vec<Pubkey>,
    pub bump: u8,
}

pub fn unix_day(ts: i64) -> i64 {
    ts.div_euclid(SECS_PER_DAY)
}

pub fn iso_week(ts: i64) -> i64 {
    // ISO week 1970-01-01 was Thursday of week 1. Shift so Monday = week boundary.
    // day 0 = 1970-01-01 (Thu). Monday anchor is day -3.
    let day = unix_day(ts);
    (day + 3).div_euclid(7)
}

pub fn validate_limits(per_tx: u64, daily: u64, weekly: u64) -> Result<()> {
    require!(
        per_tx <= daily && daily <= weekly,
        TreasuryError::InvalidLimits
    );
    Ok(())
}

pub fn apply_rollover(treasury: &mut AgentTreasury, now: i64) {
    let today = unix_day(now);
    if today > treasury.last_reset_day {
        treasury.spent_today = 0;
        treasury.last_reset_day = today;
    }
    let week = iso_week(now);
    if week > treasury.last_reset_week {
        treasury.spent_this_week = 0;
        treasury.last_reset_week = week;
    }
}

// ORACLE-STUB — real implementation reads Pyth/Switchboard price feed,
// validates status == Trading, staleness < MAX_STALENESS_SECS,
// confidence / price * 10_000 <= MAX_CONFIDENCE_BPS.
pub struct OraclePrice {
    pub price: u64,
    pub staleness: i64,
    pub confidence_bps: u64,
}

pub fn read_price(_payer_mint: &Pubkey, _payout_mint: &Pubkey) -> Result<OraclePrice> {
    Ok(OraclePrice {
        price: 1,
        staleness: 0,
        confidence_bps: 0,
    })
}

pub fn guard_oracle(p: &OraclePrice) -> Result<()> {
    require!(p.staleness <= MAX_STALENESS_SECS, TreasuryError::OracleStale);
    require!(
        p.confidence_bps <= MAX_CONFIDENCE_BPS,
        TreasuryError::OracleConfidenceTooWide
    );
    Ok(())
}

// JUPITER-CPI-STUB — real implementation CPIs into Jupiter aggregator with
// a min-out computed from the oracle price and slippage bps, deposits proceeds
// into the agent vault, and returns the actual payout amount.
pub fn swap_via_jupiter(
    _payer_mint: &Pubkey,
    _payout_mint: &Pubkey,
    amount_in: u64,
    _min_out: u64,
) -> Result<u64> {
    Ok(amount_in)
}

// AGENT-CPI-STUB — real implementation reads AgentRegistry::AgentAccount
// for (operator, agent_id) and asserts did match + status == Active.
pub fn check_agent_operator(
    _agent_registry: &Pubkey,
    _operator: &Pubkey,
    _agent_did: &[u8; 32],
) -> Result<()> {
    Ok(())
}
