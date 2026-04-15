use anyhow::{Context, Result};

#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub rpc_url: String,
    pub poll_interval_ms: u64,
    pub page_limit: u16,
    pub healthcheck_port: u16,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let rpc_url = std::env::var("SOLANA_RPC_URL").ok().or_else(|| {
            let key = std::env::var("HELIUS_API_KEY")
                .or_else(|_| std::env::var("HELIUS_API_KEY_SAEP"))
                .ok()?;
            let cluster = std::env::var("SOLANA_CLUSTER").unwrap_or_else(|_| "devnet".into());
            let host = match cluster.as_str() {
                "mainnet" | "mainnet-beta" => "mainnet.helius-rpc.com",
                _ => "devnet.helius-rpc.com",
            };
            Some(format!("https://{host}/?api-key={key}"))
        })
        .context("SOLANA_RPC_URL (or HELIUS_API_KEY + SOLANA_CLUSTER)")?;

        Ok(Self {
            database_url: std::env::var("DATABASE_URL").context("DATABASE_URL")?,
            rpc_url,
            poll_interval_ms: std::env::var("POLL_INTERVAL_MS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(2000),
            page_limit: std::env::var("RPC_PAGE_LIMIT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(200),
            healthcheck_port: std::env::var("HEALTHCHECK_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(8080),
        })
    }
}

impl std::fmt::Debug for Config {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Config")
            .field("database_url", &"***")
            .field("rpc_url", &redact_key(&self.rpc_url))
            .field("poll_interval_ms", &self.poll_interval_ms)
            .field("page_limit", &self.page_limit)
            .field("healthcheck_port", &self.healthcheck_port)
            .finish()
    }
}

fn redact_key(url: &str) -> String {
    if let Some(idx) = url.find("api-key=") {
        let mut s = url[..idx + 8].to_string();
        s.push_str("***");
        s
    } else {
        url.to_string()
    }
}
