use axum::{response::IntoResponse, routing::get, Router};

use crate::db::PgPool;
use crate::metrics;

pub fn router(_pool: PgPool) -> Router {
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/metrics", get(metrics_handler))
}

async fn metrics_handler() -> impl IntoResponse {
    (
        [("content-type", "text/plain; version=0.0.4")],
        metrics::render(),
    )
}
