//! Durable nonce account lifecycle for settlement workers.
//!
//! One nonce account per worker. Recycled after either:
//! - `max_uses` txs (default 100), or
//! - `max_age` elapsed (default 1h),
//! whichever trips first. Spec: bundles must survive leader rotation, so a
//! durable nonce replaces the recent-blockhash race.
//!
//! This module tracks state + drives the advance/recycle decisions. It does
//! NOT load keypair files (caller supplies the keypair path via env — the
//! worker process is what actually signs the advance-nonce ix). Keypairs
//! are never written to disk by this module.

use std::time::{Duration, Instant};

use thiserror::Error;

#[derive(Clone, Debug)]
pub struct NonceConfig {
    pub max_uses: u32,
    pub max_age: Duration,
}

impl Default for NonceConfig {
    fn default() -> Self {
        Self {
            max_uses: 100,
            max_age: Duration::from_secs(3600),
        }
    }
}

#[derive(Debug, Error)]
pub enum NonceError {
    #[error("nonce not initialised")]
    Uninit,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NonceState {
    Uninit,
    Active { uses: u32, age_secs: u64 },
    NeedsRecycle,
}

/// State-only manager. The actual on-chain advance-nonce ix is built by the
/// worker and signed by the worker keypair — this struct just tells the
/// worker *when* to do it and exposes the authority pubkey bytes.
pub struct NonceAccountManager {
    cfg: NonceConfig,
    authority: Option<[u8; 32]>,
    nonce_account: Option<[u8; 32]>,
    installed_at: Option<Instant>,
    uses: u32,
}

impl NonceAccountManager {
    pub fn new(cfg: NonceConfig) -> Self {
        Self {
            cfg,
            authority: None,
            nonce_account: None,
            installed_at: None,
            uses: 0,
        }
    }

    /// Install a fresh nonce. Resets counters.
    pub fn install(&mut self, nonce_account: [u8; 32], authority: [u8; 32]) {
        self.nonce_account = Some(nonce_account);
        self.authority = Some(authority);
        self.installed_at = Some(Instant::now());
        self.uses = 0;
    }

    pub fn fetch_nonce_pubkey(&self) -> Result<[u8; 32], NonceError> {
        self.nonce_account.ok_or(NonceError::Uninit)
    }

    pub fn authority_pubkey(&self) -> Result<[u8; 32], NonceError> {
        self.authority.ok_or(NonceError::Uninit)
    }

    /// Call after every tx landed (or intended to be landed).
    pub fn advance_nonce(&mut self) {
        self.uses = self.uses.saturating_add(1);
    }

    pub fn state(&self) -> NonceState {
        let Some(at) = self.installed_at else {
            return NonceState::Uninit;
        };
        let age = at.elapsed();
        if self.uses >= self.cfg.max_uses || age >= self.cfg.max_age {
            NonceState::NeedsRecycle
        } else {
            NonceState::Active {
                uses: self.uses,
                age_secs: age.as_secs(),
            }
        }
    }

    pub fn needs_recycle(&self) -> bool {
        matches!(self.state(), NonceState::NeedsRecycle)
    }

    /// Marks the current nonce as consumed. Worker then calls `install`
    /// with a freshly created/initialised nonce account.
    pub fn mark_recycled(&mut self) {
        self.nonce_account = None;
        self.installed_at = None;
        self.uses = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_uninit() {
        let m = NonceAccountManager::new(NonceConfig::default());
        assert_eq!(m.state(), NonceState::Uninit);
        assert!(m.fetch_nonce_pubkey().is_err());
    }

    #[test]
    fn recycle_triggers_after_max_uses() {
        let cfg = NonceConfig {
            max_uses: 3,
            max_age: Duration::from_secs(3600),
        };
        let mut m = NonceAccountManager::new(cfg);
        m.install([1; 32], [2; 32]);
        m.advance_nonce();
        m.advance_nonce();
        assert!(matches!(m.state(), NonceState::Active { .. }));
        m.advance_nonce();
        assert_eq!(m.state(), NonceState::NeedsRecycle);
    }

    #[test]
    fn recycle_triggers_after_max_age() {
        let cfg = NonceConfig {
            max_uses: 1_000,
            max_age: Duration::from_millis(1),
        };
        let mut m = NonceAccountManager::new(cfg);
        m.install([1; 32], [2; 32]);
        std::thread::sleep(Duration::from_millis(5));
        assert!(m.needs_recycle());
    }

    #[test]
    fn mark_recycled_clears() {
        let mut m = NonceAccountManager::new(NonceConfig::default());
        m.install([9; 32], [7; 32]);
        m.advance_nonce();
        m.mark_recycled();
        assert_eq!(m.state(), NonceState::Uninit);
    }
}
