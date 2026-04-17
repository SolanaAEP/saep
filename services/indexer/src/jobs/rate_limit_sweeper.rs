//! Periodic sweeper for the discovery rate limiter.
//!
//! Cycle 106 landed `ANONYMOUS_LIMITER` as a process-scoped singleton backing
//! the per-IP throttle on `/v1/discovery/*`. The limiter's `max_keys` cap
//! (default 10_000) bounds worst-case memory, but a steady trickle of
//! unique-IP traffic would keep the map at the cap indefinitely. The sweeper
//! reclaims buckets that have (a) refilled to full capacity and (b) sat idle
//! past the configured `idle_secs` window, matching IACP's
//! `services/iacp/src/rate_limit.ts` sweep semantics.
//!
//! Also publishes `saep_discovery_rate_limiter_buckets{scope}` as an
//! operational gauge so Grafana can chart active bucket count over time
//! without scraping limiter internals, and
//! `saep_discovery_rate_limiter_sweeps_total{scope}` as a cumulative counter
//! of reclaimed buckets so long-horizon churn (bucket-drops per hour, e.g.)
//! is queryable via `rate()` without relying on gauge deltas.
//!
//! Cross-replica coordination is out of scope at M1 (Render runs the
//! discovery surface single-instance).

use std::time::{Duration, Instant};

use tokio::time::MissedTickBehavior;

use crate::metrics;
use crate::rate_limit::{KeyedRateLimiter, ANONYMOUS_LIMITER};

pub const DEFAULT_INTERVAL_S: u64 = 30;

pub async fn run(interval: Duration) {
    let mut ticker = tokio::time::interval(interval);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        ticker.tick().await;
        let now = Instant::now();
        let mut limiter = match ANONYMOUS_LIMITER.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        sweep_and_report(&mut limiter, now, "ip");
    }
}

fn sweep_and_report(limiter: &mut KeyedRateLimiter, now: Instant, scope: &'static str) -> usize {
    let dropped = limiter.sweep(now);
    metrics::DISCOVERY_RATE_LIMITER_BUCKETS
        .with_label_values(&[scope])
        .set(limiter.len() as i64);
    if dropped > 0 {
        metrics::DISCOVERY_RATE_LIMITER_SWEEPS_TOTAL
            .with_label_values(&[scope])
            .inc_by(dropped as u64);
        tracing::debug!(dropped, scope, "rate-limit sweep");
    }
    dropped
}

pub fn interval_from_env() -> Duration {
    let secs = std::env::var("DISCOVERY_RL_SWEEP_SECS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|n| *n > 0)
        .unwrap_or(DEFAULT_INTERVAL_S);
    Duration::from_secs(secs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rate_limit::TokenBucketConfig;

    #[test]
    fn sweep_and_report_drops_idle_and_keeps_hot() {
        // idle=50ms window; idle1/idle2 touched at t0, hot at t0+40ms,
        // sweep at t0+60ms → idle buckets are 60ms old (>= 50ms idle), hot
        // is 20ms old (< 50ms) and must survive regardless of refill.
        let cfg = TokenBucketConfig {
            capacity: 2.0,
            refill_per_ms: 1.0,
        };
        let mut limiter = KeyedRateLimiter::new(cfg, Duration::from_millis(50), 16);
        let t0 = Instant::now();
        limiter.consume("idle1", 0.0, t0);
        limiter.consume("idle2", 0.0, t0);
        limiter.consume("hot", 2.0, t0 + Duration::from_millis(40));
        let later = t0 + Duration::from_millis(60);
        let dropped = sweep_and_report(&mut limiter, later, "test_sweep_idle");
        assert_eq!(dropped, 2, "both idle buckets should be swept");
        assert_eq!(limiter.len(), 1, "hot bucket remains");
    }

    #[test]
    fn sweep_and_report_increments_sweeps_total_by_dropped_count() {
        let scope = "test_sweep_counter";
        let before = metrics::DISCOVERY_RATE_LIMITER_SWEEPS_TOTAL
            .with_label_values(&[scope])
            .get();
        let cfg = TokenBucketConfig {
            capacity: 1.0,
            refill_per_ms: 1.0,
        };
        let mut limiter = KeyedRateLimiter::new(cfg, Duration::from_millis(20), 16);
        let t0 = Instant::now();
        limiter.consume("a", 0.0, t0);
        limiter.consume("b", 0.0, t0);
        limiter.consume("c", 0.0, t0);
        let dropped = sweep_and_report(
            &mut limiter,
            t0 + Duration::from_millis(30),
            // `&'static str` requirement — pass the same literal used for
            // the `before` snapshot.
            "test_sweep_counter",
        );
        assert_eq!(dropped, 3);
        let after = metrics::DISCOVERY_RATE_LIMITER_SWEEPS_TOTAL
            .with_label_values(&[scope])
            .get();
        assert_eq!(after - before, 3);

        // Second sweep with nothing to drop must not increment further.
        let noop = sweep_and_report(
            &mut limiter,
            t0 + Duration::from_millis(40),
            "test_sweep_counter",
        );
        assert_eq!(noop, 0);
        let still = metrics::DISCOVERY_RATE_LIMITER_SWEEPS_TOTAL
            .with_label_values(&[scope])
            .get();
        assert_eq!(still, after);
    }

    #[test]
    fn sweep_and_report_is_noop_on_empty_limiter() {
        let cfg = TokenBucketConfig {
            capacity: 1.0,
            refill_per_ms: 1.0,
        };
        let mut limiter = KeyedRateLimiter::new(cfg, Duration::from_millis(10), 16);
        let dropped = sweep_and_report(&mut limiter, Instant::now(), "test_sweep_empty");
        assert_eq!(dropped, 0);
        assert_eq!(limiter.len(), 0);
    }

    // Env-var names are process-global; all branches consolidated into one
    // test so parallel cargo-test execution can't race two tests mutating the
    // same key.
    #[test]
    fn interval_from_env_branches() {
        let key = "DISCOVERY_RL_SWEEP_SECS";
        std::env::remove_var(key);
        assert_eq!(interval_from_env(), Duration::from_secs(DEFAULT_INTERVAL_S));
        std::env::set_var(key, "0");
        assert_eq!(interval_from_env(), Duration::from_secs(DEFAULT_INTERVAL_S));
        std::env::set_var(key, "not-a-number");
        assert_eq!(interval_from_env(), Duration::from_secs(DEFAULT_INTERVAL_S));
        std::env::set_var(key, "5");
        assert_eq!(interval_from_env(), Duration::from_secs(5));
        std::env::remove_var(key);
    }
}
