//! Off-chain MEV/Jito settlement worker for SAEP.
//!
//! Ships as a lib module + optional `saep-settlement-worker` bin (behind the
//! `settlement-worker` cargo feature). NOT auto-started from `main.rs` — the
//! indexer stays a poller + HTTP API. Operators run the worker separately.
//!
//! Spec: `specs/mev-settlement.md`.
//!
//! ## Layout
//! - `jito_client` — REST client for block-engine `sendBundle`,
//!   `getInflightBundleStatuses`, `getTipAccounts`.
//! - `tip_oracle` — computes tip lamports from Jito bundle tip stream
//!   (p50 × 1.2, clamped to `[floor, min(cap_abs, 1% of payment)]`).
//! - `nonce_accounts` — durable nonce lifecycle (1 per worker, recycle every
//!   100 txs or 1h).
//! - `tx_builder` — translates an IACP trigger event into the atomic ix
//!   bundle per the spec's Affected-ix table.
//! - `worker` — IACP subscriber loop, dispatch, retry + fallback policy.

pub mod jito_client;
pub mod nonce_accounts;
pub mod tip_oracle;
pub mod tx_builder;
pub mod worker;

pub use jito_client::{JitoClient, JitoClientConfig, JitoError, TipAccount};
pub use nonce_accounts::{NonceAccountManager, NonceConfig, NonceState};
pub use tip_oracle::{clamp_tip, TipOracle, TipOracleConfig};
pub use tx_builder::{AccountMeta, Instruction, SettlementTrigger, TxBuilder, WorkerProgramIds};
pub use worker::{SettlementWorker, WorkerConfig};

/// Maximum txs per Jito bundle per protocol.
pub const MAX_BUNDLE_TXS: usize = 5;

/// IACP trigger topic names this worker subscribes to.
pub mod topics {
    pub const TASK_VERIFIED: &str = "task.verified";
    pub const TASK_DISPUTED: &str = "task.disputed";
    pub const BID_REVEAL_ENDED: &str = "bid.reveal_ended";
}
