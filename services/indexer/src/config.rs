use anyhow::{Context, Result};

#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub yellowstone_endpoint: String,
    pub yellowstone_x_token: Option<String>,
    pub healthcheck_port: u16,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            database_url: std::env::var("DATABASE_URL").context("DATABASE_URL")?,
            yellowstone_endpoint: std::env::var("YELLOWSTONE_ENDPOINT")
                .context("YELLOWSTONE_ENDPOINT")?,
            yellowstone_x_token: std::env::var("YELLOWSTONE_X_TOKEN").ok(),
            healthcheck_port: std::env::var("HEALTHCHECK_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(8080),
        })
    }
}
