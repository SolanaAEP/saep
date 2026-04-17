use anchor_lang::prelude::*;

use crate::errors::TreasuryError;

pub const MAX_ALLOWED_MINTS: usize = 16;
pub const MAX_CALL_TARGETS: usize = 32;
pub const MAX_GLOBAL_CALL_TARGETS: usize = 8;
pub const SECS_PER_DAY: i64 = 86_400;
pub const SECS_PER_WEEK: i64 = 604_800;
pub const DEFAULT_MAX_STREAM_DURATION: i64 = 30 * SECS_PER_DAY;

pub const MAX_STALENESS_SECS: i64 = 60;
pub const MAX_CONFIDENCE_BPS: u64 = 100;
pub const DEFAULT_SLIPPAGE_BPS: u64 = 50;
pub const BPS_DENOM: u64 = 10_000;
pub const BASE_DECIMALS: u8 = 6;
pub const MAX_ROUTE_DATA_LEN: usize = 512;

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
    // Fallback whitelist honored when an agent has no AllowedTargets PDA yet.
    // See specs/pre-audit-01-typed-task-schema.md §treasury_standard.
    #[max_len(MAX_GLOBAL_CALL_TARGETS)]
    pub global_call_targets: Vec<Pubkey>,
    // fee_collector::HookAllowlist PDA pointer. Starts as Pubkey::default() and
    // is wired once via `set_hook_allowlist_ptr`; once set it is immutable.
    // See specs/pre-audit-05-transferhook-whitelist.md.
    pub hook_allowlist: Pubkey,
}

#[account]
#[derive(InitSpace)]
pub struct AllowedTargets {
    pub agent_did: [u8; 32],
    #[max_len(MAX_CALL_TARGETS)]
    pub targets: Vec<Pubkey>,
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

// Helper: resolve + bind the hook allowlist account passed into a transfer-CPI
// instruction against the pointer stored on TreasuryGlobal. Returns None if the
// pointer is unset (warn-only M1 devnet mode), otherwise Some(&HookAllowlist)
// after asserting the passed account matches. The helper returns None without
// error when the pointer is unset so the instruction still runs — hook
// enforcement is gated behind `set_hook_allowlist_ptr`.
pub fn resolve_hook_allowlist<'a, 'info>(
    global: &TreasuryGlobal,
    passed: Option<&'a Account<'info, fee_collector::HookAllowlist>>,
) -> Result<Option<&'a fee_collector::HookAllowlist>> {
    if global.hook_allowlist == Pubkey::default() {
        return Ok(None);
    }
    let acct = passed.ok_or(TreasuryError::HookAllowlistMismatch)?;
    require_keys_eq!(
        acct.key(),
        global.hook_allowlist,
        TreasuryError::HookAllowlistMismatch
    );
    Ok(Some(acct.as_ref()))
}

// Pure-logic variant for unit tests; matches resolve_hook_allowlist's branches
// without needing an Anchor account harness.
pub fn hook_gate_active(
    global_ptr: &Pubkey,
    passed_key: Option<&Pubkey>,
) -> Result<bool> {
    if *global_ptr == Pubkey::default() {
        return Ok(false);
    }
    let k = passed_key.ok_or(TreasuryError::HookAllowlistMismatch)?;
    require_keys_eq!(*k, *global_ptr, TreasuryError::HookAllowlistMismatch);
    Ok(true)
}

// Returns Ok if `target` is in the per-agent list (when present), otherwise falls
// back to `global_call_targets`. Per-agent presence overrides global — passing
// an empty per-agent list with `Some(list)` means "deny all" and callers must
// instead pass `None` to use the global fallback.
pub fn assert_call_target_allowed(
    global: &TreasuryGlobal,
    agent_targets: Option<&AllowedTargets>,
    target: &Pubkey,
) -> Result<()> {
    match agent_targets {
        Some(list) => {
            require!(
                list.targets.iter().any(|t| t == target),
                TreasuryError::TargetNotAllowed
            );
        }
        None => {
            require!(
                global.global_call_targets.iter().any(|t| t == target),
                TreasuryError::TargetNotAllowed
            );
        }
    }
    Ok(())
}

pub fn validate_and_dedup_targets(targets: &[Pubkey]) -> Result<Vec<Pubkey>> {
    require!(
        targets.len() <= MAX_CALL_TARGETS,
        TreasuryError::TooManyCallTargets
    );
    let mut out: Vec<Pubkey> = Vec::with_capacity(targets.len());
    for t in targets {
        require!(*t != Pubkey::default(), TreasuryError::InvalidCallTarget);
        if !out.iter().any(|e| e == t) {
            out.push(*t);
        }
    }
    Ok(out)
}

pub fn apply_target_mutation(
    existing: &mut Vec<Pubkey>,
    add: &[Pubkey],
    remove: &[Pubkey],
) -> Result<()> {
    for r in remove {
        existing.retain(|t| t != r);
    }
    for a in add {
        require!(*a != Pubkey::default(), TreasuryError::InvalidCallTarget);
        if !existing.iter().any(|t| t == a) {
            existing.push(*a);
        }
    }
    require!(
        existing.len() <= MAX_CALL_TARGETS,
        TreasuryError::TooManyCallTargets
    );
    Ok(())
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

// Fields must match the on-chain Pyth PriceUpdateV2 binary layout exactly —
// AnchorDeserialize reads them positionally, so unused fields still occupy space.
#[allow(dead_code)]
#[derive(AnchorDeserialize)]
enum PythVerificationLevel {
    Partial { num_signatures: u8 },
    Full,
}

#[allow(dead_code)]
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

#[allow(dead_code)]
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

    let exp_abs: u32 = combined_exp
        .unsigned_abs()
        .try_into()
        .map_err(|_| error!(TreasuryError::ArithmeticOverflow))?;
    let factor = 10u128
        .checked_pow(exp_abs)
        .ok_or(TreasuryError::ArithmeticOverflow)?;

    let ideal = if combined_exp >= 0 {
        numerator
            .checked_mul(factor)
            .ok_or(TreasuryError::ArithmeticOverflow)?
            .checked_div(payout_p)
            .ok_or(TreasuryError::ArithmeticOverflow)?
    } else {
        let denom = payout_p
            .checked_mul(factor)
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

    let exp_abs: u32 = combined_exp
        .unsigned_abs()
        .try_into()
        .map_err(|_| error!(TreasuryError::ArithmeticOverflow))?;
    let factor = 10u128
        .checked_pow(exp_abs)
        .ok_or(TreasuryError::ArithmeticOverflow)?;

    let result = if combined_exp >= 0 {
        numerator
            .checked_mul(factor)
            .ok_or(TreasuryError::ArithmeticOverflow)?
    } else {
        numerator / factor
    };

    u64::try_from(result).map_err(|_| error!(TreasuryError::ArithmeticOverflow))
}

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::prelude::*;

    fn oracle(price: i64, exponent: i32) -> OraclePrice {
        OraclePrice { price, conf: 0, exponent }
    }

    proptest! {
        #[test]
        fn validate_limits_chain_accepts(
            per_tx in 0u64..=1_000_000_000_000u64,
            d_extra in 0u64..=1_000_000_000_000u64,
            w_extra in 0u64..=1_000_000_000_000u64,
        ) {
            let daily = per_tx.saturating_add(d_extra);
            let weekly = daily.saturating_add(w_extra);
            prop_assert!(validate_limits(per_tx, daily, weekly).is_ok());
        }

        #[test]
        fn validate_limits_per_tx_gt_daily_rejected(
            daily in 0u64..u64::MAX,
            extra in 1u64..=1_000_000u64,
        ) {
            let per_tx = daily.saturating_add(extra);
            prop_assume!(per_tx > daily);
            let weekly = per_tx;
            prop_assert!(validate_limits(per_tx, daily, weekly).is_err());
        }

        #[test]
        fn validate_limits_daily_gt_weekly_rejected(
            weekly in 0u64..u64::MAX,
            extra in 1u64..=1_000_000u64,
        ) {
            let daily = weekly.saturating_add(extra);
            prop_assume!(daily > weekly);
            let per_tx = 0u64;
            prop_assert!(validate_limits(per_tx, daily, weekly).is_err());
        }

        #[test]
        fn unix_day_no_panic(ts in any::<i64>()) {
            let _ = unix_day(ts);
        }

        #[test]
        fn unix_day_monotonic(a in -i64::MAX/2..=i64::MAX/2, b in 0i64..=SECS_PER_DAY * 1000) {
            prop_assert!(unix_day(a + b) >= unix_day(a));
        }

        #[test]
        fn iso_week_no_panic(ts in any::<i64>()) {
            let _ = iso_week(ts);
        }

        #[test]
        fn iso_week_monotonic(a in -i64::MAX/2..=i64::MAX/2, b in 0i64..=SECS_PER_WEEK * 100) {
            prop_assert!(iso_week(a + b) >= iso_week(a));
        }

        #[test]
        fn guard_oracle_non_positive_rejected(
            price in i64::MIN..=0i64,
            conf in any::<u64>(),
            exp in any::<i32>(),
        ) {
            let p = OraclePrice { price, conf, exponent: exp };
            prop_assert!(guard_oracle(&p).is_err());
        }

        #[test]
        fn guard_oracle_within_band_accepted(
            // bound price so conf * BPS_DENOM stays in u64; covers any realistic
            // Pyth price (BTC at $100k with 8 decimals = 1e13).
            price in 1i64..=1_000_000_000_000_000i64,
            share_bps in 0u64..=MAX_CONFIDENCE_BPS,
        ) {
            let conf = ((price as u128) * (share_bps as u128) / BPS_DENOM as u128) as u64;
            let p = OraclePrice { price, conf, exponent: 0 };
            prop_assert!(guard_oracle(&p).is_ok());
        }

        #[test]
        fn guard_oracle_no_panic(
            price in any::<i64>(),
            conf in any::<u64>(),
            exp in any::<i32>(),
        ) {
            let p = OraclePrice { price, conf, exponent: exp };
            let _ = guard_oracle(&p);
        }

        #[test]
        fn normalize_no_panic_on_extremes(
            raw in any::<u64>(),
            price in 1i64..=i64::MAX,
            exp in -32i32..=32i32,
            dec in 0u8..=18u8,
        ) {
            let _ = normalize_to_base_units(raw, &oracle(price, exp), dec);
        }

        #[test]
        fn normalize_monotonic_in_raw(
            raw_a in 0u64..=1_000_000_000u64,
            raw_b in 0u64..=1_000_000_000u64,
            price in 1i64..=1_000_000i64,
            dec in 0u8..=12u8,
        ) {
            // Non-strict monotonicity only — integer division can collapse
            // distinct raw inputs to the same base-unit output.
            let o = oracle(price, -8);
            let va = normalize_to_base_units(raw_a, &o, dec).unwrap();
            let vb = normalize_to_base_units(raw_b, &o, dec).unwrap();
            if raw_a <= raw_b {
                prop_assert!(va <= vb);
            } else {
                prop_assert!(va >= vb);
            }
        }

        #[test]
        fn swap_min_out_no_panic(
            claimable in any::<u64>(),
            payer_p in 1i64..=i64::MAX,
            payout_p in 1i64..=i64::MAX,
            payer_e in -32i32..=32i32,
            payout_e in -32i32..=32i32,
            payer_d in 0u8..=18u8,
            payout_d in 0u8..=18u8,
            slip in 0u64..=BPS_DENOM,
        ) {
            let _ = compute_swap_min_out(
                claimable,
                &oracle(payer_p, payer_e),
                &oracle(payout_p, payout_e),
                payer_d,
                payout_d,
                slip,
            );
        }

        #[test]
        fn swap_min_out_zero_slippage_max(
            claimable in 1u64..=1_000_000u64,
            price in 1i64..=1_000i64,
            slip_a in 0u64..=BPS_DENOM/2,
            slip_b in 0u64..=BPS_DENOM/2,
        ) {
            let p = oracle(price, -6);
            let lo_slip = slip_a.min(slip_b);
            let hi_slip = slip_a.max(slip_b);
            let lo = compute_swap_min_out(claimable, &p, &p, 6, 6, lo_slip).unwrap();
            let hi = compute_swap_min_out(claimable, &p, &p, 6, 6, hi_slip).unwrap();
            prop_assert!(lo >= hi);
        }

        #[test]
        fn swap_min_out_same_price_returns_claimable_minus_slip(
            claimable in 1u64..=1_000_000u64,
            price in 1i64..=1_000i64,
            slip in 0u64..=BPS_DENOM,
        ) {
            let p = oracle(price, -6);
            let out = compute_swap_min_out(claimable, &p, &p, 6, 6, slip).unwrap();
            let expected = (claimable as u128) * ((BPS_DENOM - slip) as u128) / BPS_DENOM as u128;
            prop_assert_eq!(out as u128, expected);
        }
    }

    fn pk(n: u8) -> Pubkey {
        Pubkey::new_from_array([n; 32])
    }

    fn empty_global() -> TreasuryGlobal {
        TreasuryGlobal {
            authority: Pubkey::default(),
            pending_authority: None,
            agent_registry: Pubkey::default(),
            jupiter_program: Pubkey::default(),
            allowed_mints: Pubkey::default(),
            max_stream_duration: 0,
            default_daily_limit: 0,
            max_daily_limit: 0,
            paused: false,
            bump: 0,
            global_call_targets: vec![],
            hook_allowlist: Pubkey::default(),
        }
    }

    #[test]
    fn validate_targets_dedups() {
        let raw = vec![pk(1), pk(2), pk(1), pk(3), pk(2)];
        let dedup = validate_and_dedup_targets(&raw).unwrap();
        assert_eq!(dedup, vec![pk(1), pk(2), pk(3)]);
    }

    #[test]
    fn validate_targets_enforces_cap() {
        let list: Vec<Pubkey> = (0..=MAX_CALL_TARGETS as u8).map(pk).collect();
        assert!(validate_and_dedup_targets(&list).is_err());
    }

    #[test]
    fn validate_targets_rejects_default_pubkey() {
        let list = vec![Pubkey::default()];
        assert!(validate_and_dedup_targets(&list).is_err());
    }

    #[test]
    fn apply_mutation_add_and_remove() {
        let mut list = vec![pk(1), pk(2), pk(3)];
        apply_target_mutation(&mut list, &[pk(4), pk(2)], &[pk(1)]).unwrap();
        assert_eq!(list, vec![pk(2), pk(3), pk(4)]);
    }

    #[test]
    fn apply_mutation_respects_cap() {
        let mut list: Vec<Pubkey> = (0..MAX_CALL_TARGETS as u8).map(pk).collect();
        let overflow = vec![pk(MAX_CALL_TARGETS as u8)];
        assert!(apply_target_mutation(&mut list, &overflow, &[]).is_err());
    }

    #[test]
    fn assert_call_target_allowed_per_agent_list() {
        let g = empty_global();
        let at = AllowedTargets { agent_did: [0u8; 32], targets: vec![pk(1), pk(2)], bump: 0 };
        assert!(assert_call_target_allowed(&g, Some(&at), &pk(1)).is_ok());
        assert!(assert_call_target_allowed(&g, Some(&at), &pk(3)).is_err());
    }

    #[test]
    fn assert_call_target_allowed_falls_back_to_global() {
        let mut g = empty_global();
        g.global_call_targets = vec![pk(7), pk(8)];
        assert!(assert_call_target_allowed(&g, None, &pk(7)).is_ok());
        assert!(assert_call_target_allowed(&g, None, &pk(9)).is_err());
    }

    #[test]
    fn hook_gate_active_skips_when_pointer_zero() {
        let ok = hook_gate_active(&Pubkey::default(), None).unwrap();
        assert!(!ok);
    }

    #[test]
    fn hook_gate_active_requires_account_when_wired() {
        let ptr = pk(11);
        assert!(hook_gate_active(&ptr, None).is_err());
    }

    #[test]
    fn hook_gate_active_rejects_mismatched_account() {
        let ptr = pk(11);
        let wrong = pk(22);
        assert!(hook_gate_active(&ptr, Some(&wrong)).is_err());
    }

    #[test]
    fn hook_gate_active_accepts_matched_account() {
        let ptr = pk(11);
        assert!(hook_gate_active(&ptr, Some(&ptr)).unwrap());
    }

    #[test]
    fn assert_call_target_allowed_empty_per_agent_denies_all() {
        let g = empty_global();
        let at = AllowedTargets { agent_did: [0u8; 32], targets: vec![], bump: 0 };
        assert!(assert_call_target_allowed(&g, Some(&at), &pk(1)).is_err());
    }
}

