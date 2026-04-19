//! In-memory token-bucket rate limiter. Single-process scope; cross-replica
//! coordination is out of scope at M1 (Render runs single-instance).
//! Spec `discovery-api.md` §Rate-limits L225: "anonymous 100 req/min/IP
//! per endpoint class"; defaults in `LimiterConfig::anonymous_default`.
//! Authenticated per-`sub` limiting deferred until Rust SIWS verifier exists.

use once_cell::sync::Lazy;
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy)]
pub struct TokenBucketConfig {
    pub capacity: f64,
    pub refill_per_ms: f64,
}

#[derive(Debug, Clone, Copy)]
struct BucketState {
    tokens: f64,
    last_refill: Instant,
    last_consumed: Instant,
}

impl BucketState {
    fn initial(capacity: f64, now: Instant) -> Self {
        Self {
            tokens: capacity,
            last_refill: now,
            last_consumed: now,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ConsumeResult {
    pub allowed: bool,
    pub retry_after_ms: u64,
}

pub struct KeyedRateLimiter {
    cfg: TokenBucketConfig,
    idle: Duration,
    max_keys: usize,
    states: HashMap<String, BucketState>,
    order: VecDeque<String>,
}

impl KeyedRateLimiter {
    pub fn new(cfg: TokenBucketConfig, idle: Duration, max_keys: usize) -> Self {
        assert!(cfg.capacity > 0.0, "capacity must be > 0");
        assert!(cfg.refill_per_ms > 0.0, "refill_per_ms must be > 0");
        assert!(max_keys > 0, "max_keys must be > 0");
        Self {
            cfg,
            idle,
            max_keys,
            states: HashMap::new(),
            order: VecDeque::new(),
        }
    }

    pub fn consume(&mut self, key: &str, amount: f64, now: Instant) -> ConsumeResult {
        if amount.is_nan() || amount < 0.0 {
            return ConsumeResult {
                allowed: false,
                retry_after_ms: 0,
            };
        }
        self.touch(key, now);
        let cfg = self.cfg;
        let state = self.states.get_mut(key).expect("touch inserts");
        Self::refill(state, now, cfg);
        if state.tokens < amount {
            let deficit = amount - state.tokens;
            let retry = (deficit / cfg.refill_per_ms).ceil() as u64;
            return ConsumeResult {
                allowed: false,
                retry_after_ms: retry,
            };
        }
        state.tokens -= amount;
        if amount > 0.0 {
            state.last_consumed = now;
        }
        ConsumeResult {
            allowed: true,
            retry_after_ms: 0,
        }
    }

    pub fn sweep(&mut self, now: Instant) -> usize {
        let cap = self.cfg.capacity;
        let cfg = self.cfg;
        let idle = self.idle;
        let dropped: Vec<String> = self
            .states
            .iter_mut()
            .filter_map(|(k, state)| {
                Self::refill(state, now, cfg);
                if state.tokens >= cap && now.duration_since(state.last_consumed) >= idle {
                    Some(k.clone())
                } else {
                    None
                }
            })
            .collect();
        let n = dropped.len();
        for k in &dropped {
            self.states.remove(k);
        }
        if n > 0 {
            self.order.retain(|k| self.states.contains_key(k));
        }
        n
    }

    pub fn len(&self) -> usize {
        self.states.len()
    }

    pub fn is_empty(&self) -> bool {
        self.states.is_empty()
    }

    fn touch(&mut self, key: &str, now: Instant) {
        if self.states.contains_key(key) {
            return;
        }
        if self.states.len() >= self.max_keys {
            self.evict_oldest();
        }
        self.states
            .insert(key.to_string(), BucketState::initial(self.cfg.capacity, now));
        self.order.push_back(key.to_string());
    }

    fn evict_oldest(&mut self) {
        while let Some(oldest) = self.order.pop_front() {
            if self.states.remove(&oldest).is_some() {
                return;
            }
        }
    }

    fn refill(state: &mut BucketState, now: Instant, cfg: TokenBucketConfig) {
        if now <= state.last_refill {
            return;
        }
        let elapsed_ms = now.duration_since(state.last_refill).as_secs_f64() * 1000.0;
        state.tokens = (state.tokens + elapsed_ms * cfg.refill_per_ms).min(cfg.capacity);
        state.last_refill = now;
    }
}

#[derive(Debug, Clone, Copy)]
pub struct LimiterConfig {
    pub burst: u32,
    pub sustained_per_min: u32,
    pub idle_secs: u64,
    pub max_keys: usize,
}

impl LimiterConfig {
    pub const fn anonymous_default() -> Self {
        Self {
            burst: 100,
            sustained_per_min: 100,
            idle_secs: 120,
            max_keys: 10_000,
        }
    }

    pub fn token_bucket(&self) -> TokenBucketConfig {
        TokenBucketConfig {
            capacity: self.burst as f64,
            refill_per_ms: self.sustained_per_min as f64 / 60_000.0,
        }
    }

    pub fn build(&self) -> KeyedRateLimiter {
        KeyedRateLimiter::new(
            self.token_bucket(),
            Duration::from_secs(self.idle_secs),
            self.max_keys,
        )
    }
}

fn config_from_env() -> LimiterConfig {
    let mut cfg = LimiterConfig::anonymous_default();
    if let Ok(v) = std::env::var("DISCOVERY_RL_BURST") {
        if let Ok(n) = v.parse::<u32>() {
            if n > 0 {
                cfg.burst = n;
            }
        }
    }
    if let Ok(v) = std::env::var("DISCOVERY_RL_PER_MIN") {
        if let Ok(n) = v.parse::<u32>() {
            if n > 0 {
                cfg.sustained_per_min = n;
            }
        }
    }
    if let Ok(v) = std::env::var("DISCOVERY_RL_IDLE_SECS") {
        if let Ok(n) = v.parse::<u64>() {
            if n > 0 {
                cfg.idle_secs = n;
            }
        }
    }
    if let Ok(v) = std::env::var("DISCOVERY_RL_MAX_KEYS") {
        if let Ok(n) = v.parse::<usize>() {
            if n > 0 {
                cfg.max_keys = n;
            }
        }
    }
    cfg
}

pub static ANONYMOUS_LIMITER: Lazy<Mutex<KeyedRateLimiter>> =
    Lazy::new(|| Mutex::new(config_from_env().build()));

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(capacity: f64, refill_per_ms: f64) -> TokenBucketConfig {
        TokenBucketConfig {
            capacity,
            refill_per_ms,
        }
    }

    #[test]
    fn consume_within_capacity() {
        let mut l = KeyedRateLimiter::new(cfg(5.0, 1.0 / 1000.0), Duration::from_secs(60), 16);
        let now = Instant::now();
        for _ in 0..5 {
            assert!(l.consume("k", 1.0, now).allowed);
        }
    }

    #[test]
    fn rejects_over_capacity_and_reports_retry_after() {
        let mut l = KeyedRateLimiter::new(cfg(2.0, 1.0 / 1000.0), Duration::from_secs(60), 16);
        let now = Instant::now();
        assert!(l.consume("k", 1.0, now).allowed);
        assert!(l.consume("k", 1.0, now).allowed);
        let r = l.consume("k", 1.0, now);
        assert!(!r.allowed);
        assert!(r.retry_after_ms >= 1000, "retry_after_ms={}", r.retry_after_ms);
    }

    #[test]
    fn refill_restores_tokens_over_time() {
        let mut l = KeyedRateLimiter::new(cfg(2.0, 1.0 / 100.0), Duration::from_secs(60), 16);
        let t0 = Instant::now();
        assert!(l.consume("k", 2.0, t0).allowed);
        assert!(!l.consume("k", 1.0, t0).allowed);
        let t1 = t0 + Duration::from_millis(100);
        assert!(l.consume("k", 1.0, t1).allowed);
    }

    #[test]
    fn refill_caps_at_capacity() {
        let mut l = KeyedRateLimiter::new(cfg(3.0, 1.0 / 10.0), Duration::from_secs(60), 16);
        let t0 = Instant::now();
        assert!(l.consume("k", 1.0, t0).allowed);
        let t1 = t0 + Duration::from_secs(60);
        assert!(l.consume("k", 3.0, t1).allowed);
        assert!(!l.consume("k", 1.0, t1).allowed);
    }

    #[test]
    fn keys_are_independent() {
        let mut l = KeyedRateLimiter::new(cfg(1.0, 1.0 / 1000.0), Duration::from_secs(60), 16);
        let now = Instant::now();
        assert!(l.consume("a", 1.0, now).allowed);
        assert!(!l.consume("a", 1.0, now).allowed);
        assert!(l.consume("b", 1.0, now).allowed);
    }

    #[test]
    fn max_keys_evicts_oldest_in_insertion_order() {
        let mut l = KeyedRateLimiter::new(cfg(1.0, 1.0 / 1000.0), Duration::from_secs(60), 2);
        let now = Instant::now();
        l.consume("a", 1.0, now);
        l.consume("b", 1.0, now);
        l.consume("c", 1.0, now);
        assert_eq!(l.len(), 2);
        let r = l.consume("a", 1.0, now);
        assert!(r.allowed, "a should have been evicted then re-created with full capacity");
    }

    #[test]
    fn sweep_removes_full_idle_buckets() {
        let mut l = KeyedRateLimiter::new(cfg(2.0, 1.0 / 1000.0), Duration::from_millis(50), 16);
        let t0 = Instant::now();
        l.consume("idle", 0.0, t0);
        l.consume("hot", 1.0, t0);
        let later = t0 + Duration::from_millis(200);
        let dropped = l.sweep(later);
        assert_eq!(dropped, 1, "only fully-refilled idle bucket should be swept");
        assert_eq!(l.len(), 1);
    }

    #[test]
    fn negative_or_nan_amount_rejected_without_state_change() {
        let mut l = KeyedRateLimiter::new(cfg(2.0, 1.0 / 1000.0), Duration::from_secs(60), 16);
        let now = Instant::now();
        assert!(!l.consume("k", -1.0, now).allowed);
        assert!(!l.consume("k", f64::NAN, now).allowed);
        assert!(l.consume("k", 1.0, now).allowed);
    }

    #[test]
    fn variable_cost_consumption() {
        let mut l = KeyedRateLimiter::new(cfg(10.0, 1.0 / 1000.0), Duration::from_secs(60), 16);
        let now = Instant::now();
        assert!(l.consume("k", 7.0, now).allowed);
        assert!(l.consume("k", 3.0, now).allowed);
        assert!(!l.consume("k", 0.5, now).allowed);
    }

    #[test]
    fn anonymous_default_capacity_matches_spec() {
        let cfg = LimiterConfig::anonymous_default();
        assert_eq!(cfg.burst, 100);
        assert_eq!(cfg.sustained_per_min, 100);
        let tb = cfg.token_bucket();
        assert!((tb.refill_per_ms - 100.0 / 60_000.0).abs() < 1e-12);
    }
}
