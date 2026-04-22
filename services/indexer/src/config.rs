use anyhow::{bail, Context, Result};

#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub rpc_url: Option<String>,
    pub poll_interval_ms: u64,
    pub page_limit: u16,
    pub healthcheck_port: u16,
    pub reorg_check_interval_s: u64,
    pub reorg_window_slots: u64,
    pub reorg_window_depth: u32,
    pub redis_url: Option<String>,
    pub api_port: Option<u16>,
    pub cors_origins: Vec<String>,
    pub matview_refresh_interval_s: u64,
    pub yellowstone_endpoint: Option<String>,
    pub yellowstone_token: Option<String>,
    pub internal_api_token: Option<String>,
    pub run_migrations: bool,
}

impl Config {
    pub fn from_env(require_rpc: bool) -> Result<Self> {
        let rpc_url = resolve_rpc_url();
        if require_rpc && rpc_url.is_none() {
            bail!("SOLANA_RPC_URL (or HELIUS_API_KEY + SOLANA_CLUSTER)");
        }

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
            reorg_check_interval_s: std::env::var("REORG_CHECK_INTERVAL_S")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(15),
            reorg_window_slots: std::env::var("REORG_WINDOW_SLOTS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(150),
            reorg_window_depth: std::env::var("REORG_WINDOW_DEPTH")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(500),
            redis_url: std::env::var("REDIS_URL")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            api_port: std::env::var("API_PORT").ok().and_then(|v| v.parse().ok()),
            cors_origins: std::env::var("CORS_ORIGINS")
                .ok()
                .map(|s| s.split(',').map(|o| o.trim().to_string()).collect())
                .unwrap_or_default(),
            matview_refresh_interval_s: std::env::var("MATVIEW_REFRESH_INTERVAL_S")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(60),
            yellowstone_endpoint: std::env::var("YELLOWSTONE_ENDPOINT")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            yellowstone_token: std::env::var("YELLOWSTONE_TOKEN")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            internal_api_token: std::env::var("INDEXER_INTERNAL_API_TOKEN")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            run_migrations: env_flag("INDEXER_RUN_MIGRATIONS"),
        })
    }

    pub fn rpc_url_required(&self) -> &str {
        self.rpc_url
            .as_deref()
            .expect("rpc_url is required when the poller role is active")
    }
}

impl std::fmt::Debug for Config {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Config")
            .field("database_url", &"***")
            .field("rpc_url", &"***")
            .field("poll_interval_ms", &self.poll_interval_ms)
            .field("page_limit", &self.page_limit)
            .field("healthcheck_port", &self.healthcheck_port)
            .field("reorg_check_interval_s", &self.reorg_check_interval_s)
            .field("reorg_window_slots", &self.reorg_window_slots)
            .field("reorg_window_depth", &self.reorg_window_depth)
            .field("redis_url", &self.redis_url.as_ref().map(|_| "***"))
            .field("api_port", &self.api_port)
            .field("cors_origins", &self.cors_origins)
            .field(
                "matview_refresh_interval_s",
                &self.matview_refresh_interval_s,
            )
            .field(
                "yellowstone_endpoint",
                &self.yellowstone_endpoint.as_ref().map(|_| "***"),
            )
            .field(
                "yellowstone_token",
                &self.yellowstone_token.as_ref().map(|_| "***"),
            )
            .field(
                "internal_api_token",
                &self.internal_api_token.as_ref().map(|_| "***"),
            )
            .field("run_migrations", &self.run_migrations)
            .finish()
    }
}

fn resolve_rpc_url() -> Option<String> {
    std::env::var("SOLANA_RPC_URL").ok().or_else(|| {
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
}

fn env_flag(name: &str) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| matches!(value.trim(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::Config;
    use std::sync::{Mutex, OnceLock};

    static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn with_env(vars: &[(&str, Option<&str>)], f: impl FnOnce()) {
        let _guard = ENV_LOCK.get_or_init(|| Mutex::new(())).lock().expect("env lock");
        let saved: Vec<(String, Option<String>)> = vars
            .iter()
            .map(|(key, _)| ((*key).to_string(), std::env::var(key).ok()))
            .collect();

        for (key, value) in vars {
            match value {
                Some(value) => unsafe { std::env::set_var(key, value) },
                None => unsafe { std::env::remove_var(key) },
            }
        }

        f();

        for (key, value) in saved {
            match value {
                Some(value) => unsafe { std::env::set_var(&key, value) },
                None => unsafe { std::env::remove_var(&key) },
            }
        }
    }

    #[test]
    fn api_mode_can_load_without_rpc_env() {
        with_env(
            &[
                ("DATABASE_URL", Some("postgres://saep:saep@localhost:5432/saep")),
                ("SOLANA_RPC_URL", None),
                ("HELIUS_API_KEY", None),
                ("HELIUS_API_KEY_SAEP", None),
                ("INDEXER_RUN_MIGRATIONS", Some("1")),
            ],
            || {
                let cfg = Config::from_env(false).expect("config");
                assert!(cfg.rpc_url.is_none());
                assert!(cfg.run_migrations);
            },
        );
    }

    #[test]
    fn poller_mode_requires_rpc_env() {
        with_env(
            &[
                ("DATABASE_URL", Some("postgres://saep:saep@localhost:5432/saep")),
                ("SOLANA_RPC_URL", None),
                ("HELIUS_API_KEY", None),
                ("HELIUS_API_KEY_SAEP", None),
            ],
            || {
                let err = Config::from_env(true).expect_err("missing rpc env should fail");
                assert!(err.to_string().contains("SOLANA_RPC_URL"));
            },
        );
    }
}
