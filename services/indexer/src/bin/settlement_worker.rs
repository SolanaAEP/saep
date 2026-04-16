//! Operator-driven bin for the settlement worker. Behind the
//! `settlement-worker` cargo feature — not part of the default `pnpm dev`
//! flow, and the indexer library build remains untouched.
//!
//! Prod signing is intentionally delegated — this bin ships with a
//! panicking stub signer so the process fails loud rather than silently
//! submitting unsigned bundles. Wire in a real signer (e.g. `solana-sdk`
//! + `ed25519-dalek`) before enabling on mainnet.

use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use tokio::sync::Mutex;

use saep_indexer::settlement_worker::{
    jito_client::{JitoClient, JitoClientConfig},
    nonce_accounts::{NonceAccountManager, NonceConfig},
    tip_oracle::{TipOracle, TipOracleConfig},
    tx_builder::{TxBuilder, WorkerProgramIds},
    worker::{BuiltBundle, BundleSigner, SettlementWorker, WorkerConfig},
};

struct UnimplementedSigner;

#[async_trait]
impl BundleSigner for UnimplementedSigner {
    async fn sign_and_serialize(&self, _bundle: &BuiltBundle) -> Result<Vec<String>> {
        bail!(
            "bundle signer not wired: build with a real ed25519 signer before running on mainnet \
             (see docs/settlement-worker.md once written)"
        );
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cfg = WorkerConfig::from_env().context("loading WorkerConfig from env")?;

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?;

    let jito_cfg = JitoClientConfig {
        block_engine_url: cfg.jito_block_engine_url.clone(),
        auth_token: std::env::var("JITO_AUTH_TOKEN").ok(),
        request_timeout: Duration::from_secs(10),
    };
    let jito = Arc::new(JitoClient::new(http.clone(), jito_cfg));

    let tip_oracle_url = std::env::var("JITO_TIP_STREAM_URL").unwrap_or_else(|_| {
        "https://bundles.jito.wtf/api/v1/bundles/tip_floor".into()
    });
    let tip_oracle = Arc::new(TipOracle::new(
        tip_oracle_url,
        http,
        TipOracleConfig {
            floor_lamports: cfg.tip_floor_lamports,
            cap_abs_lamports: cfg.tip_cap_lamports,
            cap_payment_fraction: cfg.tip_cap_pct,
            ..Default::default()
        },
    ));

    let builder = TxBuilder::new(WorkerProgramIds::from_registry()?);
    let nonces = Arc::new(Mutex::new(NonceAccountManager::new(NonceConfig::default())));
    let signer: Arc<dyn BundleSigner> = Arc::new(UnimplementedSigner);

    let worker = SettlementWorker::new(cfg, builder, jito, tip_oracle, signer, nonces);
    worker.run().await
}
