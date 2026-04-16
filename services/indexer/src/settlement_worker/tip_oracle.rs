//! Tip oracle: pulls recent Jito bundle tip samples, returns p50 × 1.2,
//! clamped to `[floor, min(cap_abs, 1% of payment_amount)]`.
//!
//! Inputs are lamport values. The oracle does not hold state across tips.

use std::time::{Duration, Instant};

use serde::Deserialize;

use super::JitoError;

#[derive(Clone, Debug)]
pub struct TipOracleConfig {
    pub floor_lamports: u64,
    pub cap_abs_lamports: u64,
    /// Fraction of task payment used as upper bound. Spec: 0.01 (1%).
    pub cap_payment_fraction: f64,
    /// Headroom multiplier over p50. Spec: 1.2.
    pub headroom: f64,
    /// How long a cached tip sample stays fresh before we refetch.
    pub cache_ttl: Duration,
}

impl Default for TipOracleConfig {
    fn default() -> Self {
        Self {
            floor_lamports: 1_000,
            cap_abs_lamports: 1_000_000,
            cap_payment_fraction: 0.01,
            headroom: 1.2,
            cache_ttl: Duration::from_secs(10),
        }
    }
}

#[derive(Deserialize, Debug, Clone)]
pub struct JitoTipSample {
    pub landed_tips_25th_percentile: Option<f64>,
    pub landed_tips_50th_percentile: Option<f64>,
    pub landed_tips_75th_percentile: Option<f64>,
    pub landed_tips_95th_percentile: Option<f64>,
}

pub struct TipOracle {
    cfg: TipOracleConfig,
    http: reqwest::Client,
    url: String,
    cached: tokio::sync::Mutex<Option<(Instant, u64)>>,
}

impl TipOracle {
    pub fn new(url: impl Into<String>, http: reqwest::Client, cfg: TipOracleConfig) -> Self {
        Self {
            cfg,
            http,
            url: url.into(),
            cached: tokio::sync::Mutex::new(None),
        }
    }

    /// Returns clamped tip for a settlement of `payment_lamports`.
    /// Uses the cached p50 if still fresh, else refetches.
    pub async fn tip_for_payment(&self, payment_lamports: u64) -> Result<u64, JitoError> {
        let base = self.current_p50_lamports().await?;
        let target = (base as f64 * self.cfg.headroom).ceil() as u64;
        Ok(clamp_tip(target, payment_lamports, &self.cfg))
    }

    /// Forces a refetch on next call — useful after a bundle rejection.
    pub async fn invalidate(&self) {
        let mut lock = self.cached.lock().await;
        *lock = None;
    }

    async fn current_p50_lamports(&self) -> Result<u64, JitoError> {
        {
            let lock = self.cached.lock().await;
            if let Some((at, value)) = *lock {
                if at.elapsed() < self.cfg.cache_ttl {
                    return Ok(value);
                }
            }
        }

        let samples = self.fetch_samples().await?;
        let p50_sol = samples
            .iter()
            .filter_map(|s| s.landed_tips_50th_percentile)
            .next()
            .unwrap_or(0.0);
        let p50_lamports = (p50_sol * 1_000_000_000f64).ceil() as u64;
        let value = p50_lamports.max(self.cfg.floor_lamports);

        let mut lock = self.cached.lock().await;
        *lock = Some((Instant::now(), value));
        Ok(value)
    }

    async fn fetch_samples(&self) -> Result<Vec<JitoTipSample>, JitoError> {
        let res = self
            .http
            .get(&self.url)
            .send()
            .await
            .map_err(|e| JitoError::Network(e.to_string()))?;
        let status = res.status();
        if status.as_u16() == 429 {
            return Err(JitoError::RateLimited);
        }
        if status.is_server_error() {
            return Err(JitoError::Server(status.as_u16()));
        }
        if !status.is_success() {
            return Err(JitoError::Client(status.as_u16()));
        }
        res.json::<Vec<JitoTipSample>>()
            .await
            .map_err(|e| JitoError::Decode(e.to_string()))
    }
}

/// Pure clamp — unit-tested. No I/O.
///
/// `target`: desired tip (usually p50 × headroom).
/// `payment_lamports`: 0 means "no payment cap, use cap_abs only".
pub fn clamp_tip(target: u64, payment_lamports: u64, cfg: &TipOracleConfig) -> u64 {
    let floor = cfg.floor_lamports;
    let cap_abs = cfg.cap_abs_lamports.max(floor);

    let cap = if payment_lamports == 0 || cfg.cap_payment_fraction <= 0.0 {
        cap_abs
    } else {
        let pay_cap = (payment_lamports as f64 * cfg.cap_payment_fraction).floor() as u64;
        cap_abs.min(pay_cap).max(floor)
    };

    target.max(floor).min(cap)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> TipOracleConfig {
        TipOracleConfig {
            floor_lamports: 1_000,
            cap_abs_lamports: 1_000_000,
            cap_payment_fraction: 0.01,
            headroom: 1.2,
            cache_ttl: Duration::from_secs(10),
        }
    }

    #[test]
    fn floor_enforced_when_target_below() {
        assert_eq!(clamp_tip(500, 0, &cfg()), 1_000);
    }

    #[test]
    fn cap_abs_enforced_when_target_above() {
        assert_eq!(clamp_tip(5_000_000, 0, &cfg()), 1_000_000);
    }

    #[test]
    fn payment_cap_overrides_cap_abs_when_smaller() {
        let c = cfg();
        let tip = clamp_tip(500_000, 10_000_000, &c);
        assert_eq!(tip, 100_000);
    }

    #[test]
    fn target_in_window_preserved() {
        assert_eq!(clamp_tip(42_000, 0, &cfg()), 42_000);
    }

    #[test]
    fn zero_payment_falls_back_to_cap_abs() {
        assert_eq!(clamp_tip(500_000, 0, &cfg()), 500_000);
    }

    #[test]
    fn floor_wins_over_misconfigured_cap() {
        let c = TipOracleConfig {
            floor_lamports: 50_000,
            cap_abs_lamports: 10_000,
            ..cfg()
        };
        assert_eq!(clamp_tip(30_000, 0, &c), 50_000);
    }

    #[test]
    fn payment_cap_raised_to_floor_when_1pct_is_tiny() {
        let c = cfg();
        let tip = clamp_tip(10_000, 10_000, &c);
        assert_eq!(tip, 1_000);
    }
}
