use anyhow::Result;
use std::net::SocketAddr;
use tokio::net::TcpListener;

use saep_indexer::{config, db, health, poller};

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cfg = config::Config::from_env()?;
    tracing::info!(?cfg, "starting saep-indexer");

    let pool = db::pool(&cfg.database_url)?;

    let health_addr: SocketAddr = format!("0.0.0.0:{}", cfg.healthcheck_port).parse()?;
    let listener = TcpListener::bind(health_addr).await?;
    let health_pool = pool.clone();
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, health::router(health_pool)).await {
            tracing::error!(error = %e, "health server crashed");
        }
    });

    poller::run(cfg, pool).await
}
