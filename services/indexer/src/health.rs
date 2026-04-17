use axum::{extract::State, response::IntoResponse, routing::get, Router};
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::api::{self, ApiState};
use crate::db::PgPool;
use crate::discovery;
use crate::metrics;
use crate::stats;

/// Internal router — bind to a separate port not exposed to the public internet.
/// Contains healthz and prometheus metrics.
pub fn internal_router(pool: PgPool) -> Router {
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/metrics", get(metrics_handler))
        .with_state(pool)
}

/// Public API router — serves leaderboard, reputation, stats.
/// Gated behind CORS with explicit origin allowlist.
pub fn public_router(pool: PgPool, allowed_origins: Vec<String>) -> Router {
    let state = ApiState { pool: pool.clone() };

    let origins: Vec<_> = allowed_origins
        .iter()
        .filter_map(|o| o.parse().ok())
        .collect();

    let cors = if origins.is_empty() {
        CorsLayer::new()
    } else {
        CorsLayer::new().allow_origin(AllowOrigin::list(origins))
    };

    Router::new()
        .merge(api::router(pool))
        .merge(stats::router(state.clone()))
        .merge(discovery::router(state))
        .layer(cors)
}

async fn metrics_handler(State(pool): State<PgPool>) -> impl IntoResponse {
    (
        [("content-type", "text/plain; version=0.0.4")],
        metrics::render(&pool),
    )
}
