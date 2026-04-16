//! Minimal Jito block-engine REST client: `sendBundle`,
//! `getInflightBundleStatuses`, `getTipAccounts`.
//!
//! Auth is per-request (`x-jito-auth`) rather than per-client so operators
//! can rotate without rebuilding. Fails gracefully on 429 / 5xx with a
//! typed [`JitoError`] so the worker can differentiate retryable vs fatal.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum JitoError {
    #[error("jito rate limited (429)")]
    RateLimited,
    #[error("jito server error: {0}")]
    Server(u16),
    #[error("jito client error: {0}")]
    Client(u16),
    #[error("jito rpc: {0}")]
    Rpc(String),
    #[error("jito network: {0}")]
    Network(String),
    #[error("jito decode: {0}")]
    Decode(String),
}

impl JitoError {
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            JitoError::RateLimited | JitoError::Server(_) | JitoError::Network(_)
        )
    }
}

#[derive(Clone, Debug)]
pub struct JitoClientConfig {
    pub block_engine_url: String,
    pub auth_token: Option<String>,
    pub request_timeout: Duration,
}

impl Default for JitoClientConfig {
    fn default() -> Self {
        Self {
            block_engine_url: "https://mainnet.block-engine.jito.wtf".into(),
            auth_token: None,
            request_timeout: Duration::from_secs(10),
        }
    }
}

pub struct JitoClient {
    http: reqwest::Client,
    cfg: JitoClientConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleInflight {
    pub bundle_id: String,
    pub status: String,
    pub slot: Option<u64>,
    #[serde(default)]
    pub err: Option<InflightErr>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InflightErr {
    pub msg: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TipAccount(pub String);

impl JitoClient {
    pub fn new(http: reqwest::Client, cfg: JitoClientConfig) -> Self {
        Self { http, cfg }
    }

    /// Submits a base58-encoded tx list as a single atomic bundle.
    /// Returns the Jito-assigned `bundleId`.
    pub async fn send_bundle(&self, b58_txs: &[String]) -> Result<String, JitoError> {
        let val: serde_json::Value = self.rpc("sendBundle", serde_json::json!([b58_txs])).await?;
        val.as_str()
            .map(str::to_string)
            .ok_or_else(|| JitoError::Rpc("sendBundle: result not a string".into()))
    }

    pub async fn get_inflight_bundle_status(
        &self,
        bundle_id: &str,
    ) -> Result<Option<BundleInflight>, JitoError> {
        #[derive(Deserialize)]
        struct Envelope {
            value: Option<Vec<BundleInflight>>,
        }
        let env: Envelope = self
            .rpc("getInflightBundleStatuses", serde_json::json!([[bundle_id]]))
            .await?;
        Ok(env.value.and_then(|v| v.into_iter().next()))
    }

    pub async fn get_tip_accounts(&self) -> Result<Vec<TipAccount>, JitoError> {
        let accounts: Vec<String> = self
            .rpc("getTipAccounts", serde_json::json!([]))
            .await?;
        Ok(accounts.into_iter().map(TipAccount).collect())
    }

    async fn rpc<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<T, JitoError> {
        let url = format!("{}/api/v1/bundles", self.cfg.block_engine_url.trim_end_matches('/'));
        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params,
        });

        let mut req = self
            .http
            .post(&url)
            .timeout(self.cfg.request_timeout)
            .json(&body);
        if let Some(token) = &self.cfg.auth_token {
            req = req.header("x-jito-auth", token);
        }

        let res = req
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

        #[derive(Deserialize)]
        struct Env<T> {
            result: Option<T>,
            error: Option<RpcErr>,
        }
        #[derive(Deserialize)]
        struct RpcErr {
            message: Option<String>,
        }

        let env: Env<T> = res
            .json()
            .await
            .map_err(|e| JitoError::Decode(e.to_string()))?;
        if let Some(err) = env.error {
            return Err(JitoError::Rpc(err.message.unwrap_or_default()));
        }
        env.result
            .ok_or_else(|| JitoError::Rpc(format!("{method}: empty result")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retryable_classification() {
        assert!(JitoError::RateLimited.is_retryable());
        assert!(JitoError::Server(503).is_retryable());
        assert!(JitoError::Network("dns".into()).is_retryable());
        assert!(!JitoError::Client(400).is_retryable());
        assert!(!JitoError::Rpc("bad".into()).is_retryable());
    }
}
