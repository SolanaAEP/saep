//! Materialized-view refresh worker.
//!
//! Drives `REFRESH MATERIALIZED VIEW CONCURRENTLY` across the three matviews
//! that back read APIs:
//!
//!   1. `reputation_rollup` (migration `2026-04-16-000003_reputation_rollup`)
//!      — backs `stats.rs` + `api.rs` leaderboard queries.
//!   2. `agent_directory` (migration `2026-04-17-000005_discovery_views`)
//!      — backs Discovery API `GET /v1/discovery/agents`. Joins
//!      `reputation_rollup`, so must refresh after it.
//!   3. `task_directory` (same migration) — backs `GET /v1/discovery/tasks`.
//!      Independent of the other two; last for parallelism.
//!
//! Also folds `reputation_samples` → `category_reputation` each tick via
//! `jobs::reputation_rollup::run` so fresh samples land before the matview
//! re-projects them.
//!
//! CONCURRENTLY requires a unique index on each matview (all three have one)
//! and does not block concurrent readers. Failure on any individual view
//! logs + increments its error counter and continues — a transient connection
//! blip should not knock the whole refresh pipeline out.

use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use diesel::prelude::*;
use diesel::sql_query;
use tokio::time::MissedTickBehavior;

use crate::db::PgPool;
use crate::jobs::reputation_rollup;
use crate::metrics;

/// Order matters: `agent_directory` joins `reputation_rollup`. `task_directory`
/// is independent but listed last to keep any DB lock bursts near the start.
const MATVIEWS: &[&str] = &["reputation_rollup", "agent_directory", "task_directory"];

pub async fn run(pool: PgPool, interval: Duration) -> Result<()> {
    let mut ticker = tokio::time::interval(interval);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
    // First tick fires immediately — warm the views at startup.
    loop {
        ticker.tick().await;
        tick_once(&pool).await;
    }
}

async fn tick_once(pool: &PgPool) {
    // reputation_rollup has its own fold+refresh pipeline.
    match reputation_rollup::run(pool).await {
        Ok(_) => metrics::MATVIEW_REFRESH_TOTAL
            .with_label_values(&["reputation_rollup", "ok"])
            .inc(),
        Err(e) => {
            tracing::warn!(error = %e, view = "reputation_rollup", "matview refresh failed");
            metrics::MATVIEW_REFRESH_TOTAL
                .with_label_values(&["reputation_rollup", "err"])
                .inc();
        }
    }

    for view in &MATVIEWS[1..] {
        match refresh_concurrently(pool, view).await {
            Ok(()) => metrics::MATVIEW_REFRESH_TOTAL
                .with_label_values(&[*view, "ok"])
                .inc(),
            Err(e) => {
                tracing::warn!(error = %e, view = *view, "matview refresh failed");
                metrics::MATVIEW_REFRESH_TOTAL
                    .with_label_values(&[*view, "err"])
                    .inc();
            }
        }
    }
}

async fn refresh_concurrently(pool: &PgPool, view: &'static str) -> Result<()> {
    let pool = pool.clone();
    tokio::task::spawn_blocking(move || -> Result<()> {
        let mut conn = pool.get().context("acquire pg conn")?;
        let stmt = format!("REFRESH MATERIALIZED VIEW CONCURRENTLY {view}");
        let started = Instant::now();
        sql_query(&stmt).execute(&mut conn).context(stmt)?;
        metrics::MATVIEW_REFRESH_DURATION
            .with_label_values(&[view])
            .observe(started.elapsed().as_secs_f64());
        Ok(())
    })
    .await
    .context("matview refresh join")?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refresh_order_is_dependency_sorted() {
        // agent_directory depends on reputation_rollup, so must come after.
        let rep_idx = MATVIEWS
            .iter()
            .position(|v| *v == "reputation_rollup")
            .unwrap();
        let agent_idx = MATVIEWS
            .iter()
            .position(|v| *v == "agent_directory")
            .unwrap();
        assert!(rep_idx < agent_idx);
    }

    #[test]
    fn all_three_matviews_listed() {
        assert_eq!(MATVIEWS.len(), 3);
        assert!(MATVIEWS.contains(&"reputation_rollup"));
        assert!(MATVIEWS.contains(&"agent_directory"));
        assert!(MATVIEWS.contains(&"task_directory"));
    }
}
