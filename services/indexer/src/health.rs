use axum::{routing::get, Router};
use crate::db::PgPool;

pub fn router(_pool: PgPool) -> Router {
    Router::new().route("/healthz", get(|| async { "ok" }))
}
