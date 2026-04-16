use axum::{extract::State, response::IntoResponse, routing::get, Router};

use crate::api::{self, ApiState};
use crate::db::PgPool;
use crate::metrics;
use crate::stats;

pub fn router(pool: PgPool) -> Router {
    let state = ApiState { pool: pool.clone() };
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/metrics", get(metrics_handler))
        .with_state(pool.clone())
        .merge(api::router(pool))
        .merge(stats::router(state))
}

async fn metrics_handler(State(pool): State<PgPool>) -> impl IntoResponse {
    (
        [("content-type", "text/plain; version=0.0.4")],
        metrics::render(&pool),
    )
}
