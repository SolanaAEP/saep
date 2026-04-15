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
pub const BASE_DECIMALS: u8 = 6;

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

pub struct OraclePrice {
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
}

#[derive(AnchorDeserialize)]
enum PythVerificationLevel {
    Partial { num_signatures: u8 },
    Full,
}

#[derive(AnchorDeserialize)]
struct PythPriceFeedMessage {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
    pub prev_publish_time: i64,
    pub ema_price: i64,
    pub ema_conf: u64,
}

#[derive(AnchorDeserialize)]
struct PythPriceUpdateV2 {
    pub write_authority: Pubkey,
    pub verification_level: PythVerificationLevel,
    pub price_message: PythPriceFeedMessage,
    pub posted_slot: u64,
}

pub fn read_oracle(feed_info: &AccountInfo, clock: &Clock) -> Result<OraclePrice> {
    let data = feed_info.try_borrow_data()?;
    require!(data.len() >= 8, TreasuryError::OracleStale);

    // sha256("account:PriceUpdateV2")[..8]
    const PYTH_DISCRIMINATOR: [u8; 8] = [0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd];
    require!(data[..8] == PYTH_DISCRIMINATOR, TreasuryError::OracleStale);

    let update = PythPriceUpdateV2::try_from_slice(&data[8..])
        .map_err(|_| error!(TreasuryError::OracleStale))?;

    let msg = &update.price_message;
    let age = clock.unix_timestamp.saturating_sub(msg.publish_time);
    require!(age >= 0 && age <= MAX_STALENESS_SECS, TreasuryError::OracleStale);

    Ok(OraclePrice {
        price: msg.price,
        conf: msg.conf,
        exponent: msg.exponent,
    })
}

pub fn guard_oracle(p: &OraclePrice) -> Result<()> {
    require!(p.price > 0, TreasuryError::OracleNonPositivePrice);
    let price_abs = p.price as u64;
    let conf_bps = p
        .conf
        .checked_mul(BPS_DENOM)
        .ok_or(TreasuryError::ArithmeticOverflow)?
        / price_abs;
    require!(
        conf_bps <= MAX_CONFIDENCE_BPS,
        TreasuryError::OracleConfidenceTooWide
    );
    Ok(())
}

pub fn compute_swap_min_out(
    claimable: u64,
    payer: &OraclePrice,
    payout: &OraclePrice,
    payer_decimals: u8,
    payout_decimals: u8,
    slippage_bps: u64,
) -> Result<u64> {
    let payer_p = payer.price as u128;
    let payout_p = payout.price as u128;

    // combined exponent accounts for both oracle exponents and token decimals:
    // actual_rate = (payer_price * 10^payer_exp / 10^payer_dec)
    //             / (payout_price * 10^payout_exp / 10^payout_dec)
    let combined_exp = (payer.exponent as i64) - (payout.exponent as i64)
        + (payout_decimals as i64)
        - (payer_decimals as i64);

    let numerator = (claimable as u128)
        .checked_mul(payer_p)
        .ok_or(TreasuryError::ArithmeticOverflow)?;

    let ideal = if combined_exp >= 0 {
        numerator
            .checked_mul(10u128.pow(combined_exp as u32))
            .ok_or(TreasuryError::ArithmeticOverflow)?
            .checked_div(payout_p)
            .ok_or(TreasuryError::ArithmeticOverflow)?
    } else {
        let denom = payout_p
            .checked_mul(10u128.pow((-combined_exp) as u32))
            .ok_or(TreasuryError::ArithmeticOverflow)?;
        numerator
            .checked_div(denom)
            .ok_or(TreasuryError::ArithmeticOverflow)?
    };

    let min_out = ideal
        .checked_mul((BPS_DENOM - slippage_bps) as u128)
        .ok_or(TreasuryError::ArithmeticOverflow)?
        / BPS_DENOM as u128;

    u64::try_from(min_out).map_err(|_| error!(TreasuryError::ArithmeticOverflow))
}

pub fn normalize_to_base_units(
    raw_amount: u64,
    oracle: &OraclePrice,
    mint_decimals: u8,
) -> Result<u64> {
    let price = oracle.price as u128;
    let combined_exp =
        (oracle.exponent as i64) + (BASE_DECIMALS as i64) - (mint_decimals as i64);

    let numerator = (raw_amount as u128)
        .checked_mul(price)
        .ok_or(TreasuryError::ArithmeticOverflow)?;

    let result = if combined_exp >= 0 {
        numerator
            .checked_mul(10u128.pow(combined_exp as u32))
            .ok_or(TreasuryError::ArithmeticOverflow)?
    } else {
        numerator / 10u128.pow((-combined_exp) as u32)
    };

    u64::try_from(result).map_err(|_| error!(TreasuryError::ArithmeticOverflow))
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
