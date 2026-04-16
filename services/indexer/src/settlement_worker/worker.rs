//! Settlement worker loop: subscribes to IACP triggers via Redis Streams,
//! expands each trigger into the bundle via [`TxBuilder`], signs externally
//! (via the `Signer` trait), submits to Jito with the retry + fallback
//! policy mandated by `specs/mev-settlement.md`.
//!
//! This module is library-only — it exposes the run-loop as [`SettlementWorker::run`]
//! so it can be driven by either the bin target (operational) or test code
//! (integration). The indexer HTTP API does not auto-spawn it.

use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use async_trait::async_trait;
use redis::{aio::ConnectionManager, AsyncCommands};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use super::{
    jito_client::{JitoClient, JitoError},
    nonce_accounts::NonceAccountManager,
    tip_oracle::TipOracle,
    topics,
    tx_builder::{Instruction, SettlementTrigger, TxBuilder},
};

/// Behaviour policy — maps 1:1 to spec open question #2.
///
/// `require_bundle=true` (default): swap/value-movement ix is held back if
/// Jito returns a hard failure; only metadata ix may degrade to plain RPC.
///
/// `require_bundle=false` (emergency override): degrade everything to plain
/// RPC — operators only, with governance sign-off.
#[derive(Clone, Debug)]
pub struct WorkerConfig {
    pub redis_url: String,
    pub stream_key: String,
    pub consumer_group: String,
    pub consumer_name: String,
    pub require_bundle: bool,
    pub tip_floor_lamports: u64,
    pub tip_cap_lamports: u64,
    pub tip_cap_pct: f64,
    pub jito_auth_keypair_path: Option<String>,
    pub jito_block_engine_url: String,
    pub max_bundle_retries: u32,
    pub poll_block_ms: u64,
}

impl WorkerConfig {
    pub fn from_env() -> Result<Self> {
        let redis_url = std::env::var("REDIS_URL").context("REDIS_URL")?;
        Ok(Self {
            redis_url,
            stream_key: std::env::var("SETTLEMENT_STREAM_KEY")
                .unwrap_or_else(|_| "saep:iacp:settlement".into()),
            consumer_group: std::env::var("SETTLEMENT_CONSUMER_GROUP")
                .unwrap_or_else(|_| "settlement-workers".into()),
            consumer_name: std::env::var("SETTLEMENT_CONSUMER_NAME")
                .unwrap_or_else(|_| "worker-0".into()),
            require_bundle: std::env::var("SETTLEMENT_REQUIRE_BUNDLE")
                .map(|v| v != "false" && v != "0")
                .unwrap_or(true),
            tip_floor_lamports: std::env::var("SETTLEMENT_TIP_FLOOR_LAMPORTS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(1_000),
            tip_cap_lamports: std::env::var("SETTLEMENT_TIP_CAP_LAMPORTS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(1_000_000),
            tip_cap_pct: std::env::var("SETTLEMENT_TIP_CAP_PCT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0.01),
            jito_auth_keypair_path: std::env::var("JITO_AUTH_KEYPAIR_PATH").ok(),
            jito_block_engine_url: std::env::var("JITO_BLOCK_ENGINE_URL")
                .unwrap_or_else(|_| "https://mainnet.block-engine.jito.wtf".into()),
            max_bundle_retries: std::env::var("SETTLEMENT_MAX_RETRIES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(2),
            poll_block_ms: std::env::var("SETTLEMENT_POLL_BLOCK_MS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(5_000),
        })
    }
}

/// What the worker produces from a trigger, ready to hand off to a signer.
#[derive(Debug, Clone)]
pub struct BuiltBundle {
    pub ixs: Vec<Instruction>,
    pub tip_lamports: u64,
    /// Base58 pubkey chosen off `getTipAccounts`.
    pub tip_account: String,
    pub trigger_ref: String,
}

/// Abstracts away the actual ed25519 signing + wire-format serialisation.
/// In prod, implemented by a thin wrapper over `solana-sdk` in the bin
/// target; in tests, a deterministic stub.
#[async_trait]
pub trait BundleSigner: Send + Sync {
    async fn sign_and_serialize(&self, bundle: &BuiltBundle) -> Result<Vec<String>>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SettlementOutcome {
    Submitted { bundle_id: String },
    Fallback { signatures: Vec<String>, reason: String },
    Stuck { reason: String },
    Skipped { reason: String },
}

pub struct SettlementWorker {
    cfg: WorkerConfig,
    builder: TxBuilder,
    jito: Arc<JitoClient>,
    tip_oracle: Arc<TipOracle>,
    signer: Arc<dyn BundleSigner>,
    nonces: Arc<Mutex<NonceAccountManager>>,
    tip_accounts_cache: Arc<Mutex<Vec<String>>>,
}

impl SettlementWorker {
    pub fn new(
        cfg: WorkerConfig,
        builder: TxBuilder,
        jito: Arc<JitoClient>,
        tip_oracle: Arc<TipOracle>,
        signer: Arc<dyn BundleSigner>,
        nonces: Arc<Mutex<NonceAccountManager>>,
    ) -> Self {
        Self {
            cfg,
            builder,
            jito,
            tip_oracle,
            signer,
            nonces,
            tip_accounts_cache: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub async fn run(&self) -> Result<()> {
        tracing::info!(
            stream = %self.cfg.stream_key,
            group = %self.cfg.consumer_group,
            consumer = %self.cfg.consumer_name,
            "settlement worker starting"
        );
        let client = redis::Client::open(self.cfg.redis_url.as_str())
            .context("redis::Client::open for settlement worker")?;
        let mut conn = ConnectionManager::new(client)
            .await
            .context("redis ConnectionManager")?;

        ensure_consumer_group(&mut conn, &self.cfg.stream_key, &self.cfg.consumer_group).await;

        loop {
            match self.read_one(&mut conn).await {
                Ok(Some((stream_id, trigger))) => {
                    let outcome = self.handle_trigger(&trigger).await;
                    self.emit_metric(&outcome);
                    if let Err(e) = ack(&mut conn, &self.cfg, &stream_id).await {
                        tracing::warn!(error = %e, "xack failed");
                    }
                }
                Ok(None) => continue,
                Err(e) => {
                    tracing::warn!(error = %e, "xreadgroup failed — backing off");
                    tokio::time::sleep(Duration::from_millis(self.cfg.poll_block_ms)).await;
                }
            }
        }
    }

    async fn read_one(
        &self,
        conn: &mut ConnectionManager,
    ) -> Result<Option<(String, SettlementTrigger)>> {
        let reply: redis::streams::StreamReadReply = redis::cmd("XREADGROUP")
            .arg("GROUP")
            .arg(&self.cfg.consumer_group)
            .arg(&self.cfg.consumer_name)
            .arg("COUNT")
            .arg(1)
            .arg("BLOCK")
            .arg(self.cfg.poll_block_ms)
            .arg("STREAMS")
            .arg(&self.cfg.stream_key)
            .arg(">")
            .query_async(conn)
            .await?;

        let Some(stream) = reply.keys.into_iter().next() else {
            return Ok(None);
        };
        let Some(entry) = stream.ids.into_iter().next() else {
            return Ok(None);
        };

        let payload = entry
            .map
            .get("payload")
            .and_then(|v| match v {
                redis::Value::BulkString(b) => std::str::from_utf8(b).ok().map(str::to_string),
                redis::Value::SimpleString(s) => Some(s.clone()),
                _ => None,
            })
            .context("stream entry missing 'payload'")?;
        let topic = entry
            .map
            .get("topic")
            .and_then(|v| match v {
                redis::Value::BulkString(b) => std::str::from_utf8(b).ok().map(str::to_string),
                redis::Value::SimpleString(s) => Some(s.clone()),
                _ => None,
            })
            .unwrap_or_default();

        if !is_known_topic(&topic) {
            tracing::debug!(topic, "ignoring unknown settlement topic");
            return Ok(Some((entry.id, SettlementTrigger::TaskDisputed { task_id: String::new() })));
        }

        let trigger: SettlementTrigger = serde_json::from_str(&payload)
            .context("decoding settlement trigger payload")?;
        Ok(Some((entry.id, trigger)))
    }

    async fn handle_trigger(&self, trigger: &SettlementTrigger) -> SettlementOutcome {
        let ixs = match self.builder.build(trigger) {
            Ok(v) if v.is_empty() => {
                return SettlementOutcome::Skipped {
                    reason: "trigger has no on-chain ix (e.g. TaskDisputed)".into(),
                };
            }
            Ok(v) => v,
            Err(e) => {
                return SettlementOutcome::Stuck {
                    reason: format!("build failed: {e}"),
                };
            }
        };

        let tip = match self
            .tip_oracle
            .tip_for_payment(trigger.payment_lamports())
            .await
        {
            Ok(t) => t,
            Err(e) => {
                tracing::warn!(error = %e, "tip oracle failed — using floor");
                self.cfg.tip_floor_lamports
            }
        };

        let tip_account = match self.tip_account().await {
            Some(a) => a,
            None => {
                return SettlementOutcome::Stuck {
                    reason: "no Jito tip accounts available".into(),
                };
            }
        };

        let bundle = BuiltBundle {
            ixs,
            tip_lamports: tip,
            tip_account,
            trigger_ref: trigger.task_id().unwrap_or("").to_string(),
        };

        let signed = match self.signer.sign_and_serialize(&bundle).await {
            Ok(s) => s,
            Err(e) => {
                return SettlementOutcome::Stuck {
                    reason: format!("signer failed: {e}"),
                };
            }
        };

        let mut last_err: Option<JitoError> = None;
        for attempt in 0..=self.cfg.max_bundle_retries {
            match self.jito.send_bundle(&signed).await {
                Ok(bundle_id) => {
                    self.nonces.lock().await.advance_nonce();
                    return SettlementOutcome::Submitted { bundle_id };
                }
                Err(e) => {
                    tracing::warn!(attempt, error = %e, "bundle submit failed");
                    if !e.is_retryable() {
                        last_err = Some(e);
                        break;
                    }
                    last_err = Some(e);
                    tokio::time::sleep(Duration::from_millis(250 * (attempt as u64 + 1))).await;
                }
            }
        }

        let reason = last_err
            .as_ref()
            .map(|e| e.to_string())
            .unwrap_or_else(|| "unknown".into());

        let has_swap = bundle_contains_swap(&bundle.ixs);
        if self.cfg.require_bundle && has_swap {
            tracing::error!(
                task = %bundle.trigger_ref,
                %reason,
                "halt policy: bundle contains swap ix, refusing fallback"
            );
            return SettlementOutcome::Stuck { reason };
        }

        SettlementOutcome::Fallback {
            signatures: Vec::new(),
            reason,
        }
    }

    async fn tip_account(&self) -> Option<String> {
        {
            let cached = self.tip_accounts_cache.lock().await;
            if let Some(first) = cached.first() {
                return Some(first.clone());
            }
        }
        match self.jito.get_tip_accounts().await {
            Ok(accounts) if !accounts.is_empty() => {
                let keys: Vec<String> = accounts.into_iter().map(|a| a.0).collect();
                let first = keys[0].clone();
                *self.tip_accounts_cache.lock().await = keys;
                Some(first)
            }
            Ok(_) => None,
            Err(e) => {
                tracing::warn!(error = %e, "getTipAccounts failed");
                None
            }
        }
    }

    fn emit_metric(&self, outcome: &SettlementOutcome) {
        match outcome {
            SettlementOutcome::Submitted { bundle_id } => {
                tracing::info!(%bundle_id, "SettlementSubmitted");
            }
            SettlementOutcome::Fallback { reason, .. } => {
                tracing::warn!(%reason, "SettlementFallback");
            }
            SettlementOutcome::Stuck { reason } => {
                tracing::error!(%reason, "SettlementStuck");
            }
            SettlementOutcome::Skipped { reason } => {
                tracing::debug!(%reason, "SettlementSkipped");
            }
        }
    }
}

fn is_known_topic(t: &str) -> bool {
    matches!(
        t,
        topics::TASK_VERIFIED | topics::TASK_DISPUTED | topics::BID_REVEAL_ENDED
    )
}

/// Conservative heuristic: any ix whose discriminator matches a known swap
/// ix name is treated as value-movement and subject to the halt policy.
fn bundle_contains_swap(ixs: &[Instruction]) -> bool {
    use super::tx_builder::anchor_discriminator;
    let swap_disc = anchor_discriminator("swap_via_jupiter");
    let stream_withdraw_disc = anchor_discriminator("stream_withdraw");
    ixs.iter().any(|ix| {
        ix.data.len() >= 8
            && (ix.data[..8] == swap_disc || ix.data[..8] == stream_withdraw_disc)
    })
}

async fn ensure_consumer_group(conn: &mut ConnectionManager, stream: &str, group: &str) {
    let res: redis::RedisResult<()> = redis::cmd("XGROUP")
        .arg("CREATE")
        .arg(stream)
        .arg(group)
        .arg("$")
        .arg("MKSTREAM")
        .query_async(conn)
        .await;
    if let Err(e) = res {
        let msg = e.to_string();
        if !msg.contains("BUSYGROUP") {
            tracing::warn!(error = %msg, stream, group, "xgroup create failed");
        }
    }
}

async fn ack(conn: &mut ConnectionManager, cfg: &WorkerConfig, id: &str) -> Result<()> {
    let _: i64 = conn
        .xack(&cfg.stream_key, &cfg.consumer_group, &[id])
        .await
        .context("xack")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settlement_worker::tx_builder::{
        anchor_discriminator, AccountMeta as IxAccountMeta, Instruction as RawIx,
    };

    #[test]
    fn swap_ix_is_detected() {
        let program_id = [1u8; 32];
        let mut data = anchor_discriminator("swap_via_jupiter").to_vec();
        data.extend_from_slice(&[0u8; 4]);
        let ix = RawIx {
            program_id,
            accounts: vec![IxAccountMeta {
                pubkey: [2; 32],
                is_signer: false,
                is_writable: true,
            }],
            data,
        };
        assert!(bundle_contains_swap(&[ix]));
    }

    #[test]
    fn non_swap_ix_is_not_flagged() {
        let ix = RawIx {
            program_id: [1; 32],
            accounts: Vec::new(),
            data: anchor_discriminator("release").to_vec(),
        };
        assert!(!bundle_contains_swap(&[ix]));
    }

    #[test]
    fn known_topic_check() {
        assert!(is_known_topic(topics::TASK_VERIFIED));
        assert!(is_known_topic(topics::TASK_DISPUTED));
        assert!(is_known_topic(topics::BID_REVEAL_ENDED));
        assert!(!is_known_topic("unrelated.thing"));
    }
}
