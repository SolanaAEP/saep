use anyhow::Result;
use std::net::SocketAddr;
use tokio::net::TcpListener;

use saep_indexer::{config, db, health, poller, pubsub, reorg};

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cfg = config::Config::from_env()?;
    tracing::info!(?cfg, "starting saep-indexer");

    let pool = db::pool(&cfg.database_url)?;
    db::run_migrations(&pool)?;
    tracing::info!("migrations applied");
    saep_indexer::metrics::set_pool_max(db::POOL_MAX_SIZE);

    let internal_addr: SocketAddr = format!("0.0.0.0:{}", cfg.healthcheck_port).parse()?;
    let internal_listener = TcpListener::bind(internal_addr).await?;
    let internal_pool = pool.clone();
    tokio::spawn(async move {
        if let Err(e) = axum::serve(internal_listener, health::internal_router(internal_pool)).await {
            tracing::error!(error = %e, "internal server crashed");
        }
    });

    let api_port = cfg.api_port.unwrap_or(cfg.healthcheck_port + 1);
    let api_addr: SocketAddr = format!("0.0.0.0:{}", api_port).parse()?;
    let api_listener = TcpListener::bind(api_addr).await?;
    let api_pool = pool.clone();
    let allowed_origins = cfg.cors_origins.clone();
    tokio::spawn(async move {
        if let Err(e) = axum::serve(api_listener, health::public_router(api_pool, allowed_origins)).await {
            tracing::error!(error = %e, "public API server crashed");
        }
    });
    tracing::info!(%internal_addr, %api_addr, "servers started");

    let reorg_cfg = cfg.clone();
    let reorg_pool = pool.clone();
    tokio::spawn(async move {
        if let Err(e) = reorg::run(reorg_cfg, reorg_pool).await {
            tracing::error!(error = %e, "reorg watcher exited");
        }
    });

    let publisher = pubsub::Publisher::from_env(cfg.redis_url.as_deref()).await;
    if publisher.enabled() {
        tracing::info!("redis pubsub fanout active");
    }

    poller::run(cfg, pool, publisher).await
}
