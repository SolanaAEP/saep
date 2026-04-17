use once_cell::sync::Lazy;
use prometheus::{
    register_histogram_vec, register_int_counter, register_int_counter_vec, register_int_gauge,
    register_int_gauge_vec, Encoder, HistogramTimer, HistogramVec, IntCounter, IntCounterVec,
    IntGauge, IntGaugeVec, TextEncoder,
};

use crate::db::PgPool;

pub static EVENTS_INGESTED: Lazy<IntCounterVec> = Lazy::new(|| {
    register_int_counter_vec!(
        "saep_indexer_events_total",
        "Events ingested from program logs",
        &["program", "event"]
    )
    .unwrap()
});

pub static RPC_ERRORS: Lazy<IntCounterVec> = Lazy::new(|| {
    register_int_counter_vec!(
        "saep_indexer_rpc_errors_total",
        "RPC errors by method",
        &["method"]
    )
    .unwrap()
});

pub static LAST_SLOT: Lazy<IntGaugeVec> = Lazy::new(|| {
    register_int_gauge_vec!(
        "saep_indexer_last_slot",
        "Highest slot observed per program",
        &["program"]
    )
    .unwrap()
});

pub static REORG_DETECTED: Lazy<IntCounterVec> = Lazy::new(|| {
    register_int_counter_vec!(
        "saep_indexer_reorgs_total",
        "Signatures detected as reorged-out, labelled by program",
        &["program"]
    )
    .unwrap()
});

pub static REORG_EVENTS_ROLLED_BACK: Lazy<IntCounter> = Lazy::new(|| {
    register_int_counter!(
        "saep_indexer_reorg_events_rolled_back_total",
        "Total program_events rows deleted across all reorg rollbacks"
    )
    .unwrap()
});

pub static DB_POOL_CONNECTIONS: Lazy<IntGauge> = Lazy::new(|| {
    register_int_gauge!(
        "saep_indexer_db_pool_connections",
        "Open connections currently held by the r2d2 pool"
    )
    .unwrap()
});

pub static DB_POOL_IDLE: Lazy<IntGauge> = Lazy::new(|| {
    register_int_gauge!(
        "saep_indexer_db_pool_idle",
        "Idle connections in the r2d2 pool"
    )
    .unwrap()
});

pub static DB_POOL_MAX: Lazy<IntGauge> = Lazy::new(|| {
    register_int_gauge!(
        "saep_indexer_db_pool_max",
        "Configured max_size on the r2d2 pool"
    )
    .unwrap()
});

pub static RPC_CALL_DURATION: Lazy<HistogramVec> = Lazy::new(|| {
    register_histogram_vec!(
        "saep_indexer_rpc_call_duration_seconds",
        "Duration of JSON-RPC calls, labelled by method",
        &["method"],
        vec![0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
    )
    .unwrap()
});

pub static POLL_CYCLE_DURATION: Lazy<HistogramVec> = Lazy::new(|| {
    register_histogram_vec!(
        "saep_indexer_poll_cycle_duration_seconds",
        "End-to-end duration of one poll cycle per program (signatures + all transactions)",
        &["program"],
        vec![0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0]
    )
    .unwrap()
});

pub static PUBSUB_PUBLISHES: Lazy<IntCounterVec> = Lazy::new(|| {
    register_int_counter_vec!(
        "saep_indexer_pubsub_publishes_total",
        "Redis Pub/Sub publish attempts, labelled by program and outcome (ok|err)",
        &["program", "status"]
    )
    .unwrap()
});

pub static INGEST_LAG: Lazy<HistogramVec> = Lazy::new(|| {
    register_histogram_vec!(
        "saep_indexer_ingest_lag_seconds",
        "Delta between transaction blockTime and ingest time. Proxy for Yellowstone lag until gRPC is wired.",
        &["program"],
        vec![0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0, 600.0]
    )
    .unwrap()
});

pub static MATVIEW_REFRESH_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    register_int_counter_vec!(
        "saep_indexer_matview_refresh_total",
        "Materialized-view refresh attempts, labelled by view and outcome (ok|err)",
        &["view", "status"]
    )
    .unwrap()
});

pub static MATVIEW_REFRESH_DURATION: Lazy<HistogramVec> = Lazy::new(|| {
    register_histogram_vec!(
        "saep_indexer_matview_refresh_duration_seconds",
        "Duration of REFRESH MATERIALIZED VIEW CONCURRENTLY per view",
        &["view"],
        vec![0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0]
    )
    .unwrap()
});

// Discovery API surface — per `specs/discovery-api.md` §Metrics. Registered
// unconditionally so `/metrics` exposes the full series set from boot; WS +
// cache + rate-limit families stay zero until those layers land in subsequent
// cycles. Request + duration families are populated by the per-router
// middleware in `discovery::metrics_mw`; `time_discovery_query` wraps
// individual SQL calls inside handlers.

pub static DISCOVERY_REQUEST_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    register_int_counter_vec!(
        "saep_discovery_request_total",
        "Discovery REST request count by endpoint class and HTTP status",
        &["endpoint", "status"]
    )
    .unwrap()
});

pub static DISCOVERY_REQUEST_DURATION: Lazy<HistogramVec> = Lazy::new(|| {
    register_histogram_vec!(
        "saep_discovery_request_duration_seconds",
        "Discovery REST request latency by endpoint class",
        &["endpoint"],
        vec![0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0]
    )
    .unwrap()
});

pub static DISCOVERY_CACHE_HITS: Lazy<IntCounterVec> = Lazy::new(|| {
    register_int_counter_vec!(
        "saep_discovery_cache_hits_total",
        "Discovery cache-layer hits by endpoint class",
        &["endpoint"]
    )
    .unwrap()
});

pub static DISCOVERY_CACHE_MISSES: Lazy<IntCounterVec> = Lazy::new(|| {
    register_int_counter_vec!(
        "saep_discovery_cache_misses_total",
        "Discovery cache-layer misses by endpoint class",
        &["endpoint"]
    )
    .unwrap()
});

pub static DISCOVERY_WS_CONNECTIONS: Lazy<IntGauge> = Lazy::new(|| {
    register_int_gauge!(
        "saep_discovery_ws_connections",
        "Open Discovery WS connections"
    )
    .unwrap()
});

pub static DISCOVERY_WS_SUBSCRIPTIONS: Lazy<IntGaugeVec> = Lazy::new(|| {
    register_int_gauge_vec!(
        "saep_discovery_ws_subscriptions",
        "Active Discovery WS subscriptions by channel",
        &["channel"]
    )
    .unwrap()
});

pub static DISCOVERY_WS_EVENTS_SENT: Lazy<IntCounterVec> = Lazy::new(|| {
    register_int_counter_vec!(
        "saep_discovery_ws_events_sent_total",
        "Discovery WS events delivered to subscribers by channel",
        &["channel"]
    )
    .unwrap()
});

pub static DISCOVERY_WS_EVENTS_DROPPED: Lazy<IntCounterVec> = Lazy::new(|| {
    register_int_counter_vec!(
        "saep_discovery_ws_events_dropped_total",
        "Discovery WS events dropped (reason: rate_limit|queue_full|auth_downgrade)",
        &["channel", "reason"]
    )
    .unwrap()
});

pub static DISCOVERY_RATE_LIMITED: Lazy<IntCounterVec> = Lazy::new(|| {
    register_int_counter_vec!(
        "saep_discovery_rate_limited_total",
        "Discovery requests rejected by rate-limit layer (scope: ip|sub|ws)",
        &["scope", "endpoint"]
    )
    .unwrap()
});

pub static DISCOVERY_RATE_LIMITER_BUCKETS: Lazy<IntGaugeVec> = Lazy::new(|| {
    register_int_gauge_vec!(
        "saep_discovery_rate_limiter_buckets",
        "Active per-key token buckets held by the discovery rate limiter (scope: ip|sub|ws)",
        &["scope"]
    )
    .unwrap()
});

pub static DISCOVERY_RATE_LIMITER_SWEEPS_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    register_int_counter_vec!(
        "saep_discovery_rate_limiter_sweeps_total",
        "Buckets reclaimed cumulatively by the discovery rate-limit sweeper",
        &["scope"]
    )
    .unwrap()
});

pub static DISCOVERY_DB_QUERY_DURATION: Lazy<HistogramVec> = Lazy::new(|| {
    register_histogram_vec!(
        "saep_discovery_db_query_duration_seconds",
        "Discovery backing query latency by named query",
        &["query"],
        vec![0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 5.0]
    )
    .unwrap()
});

pub fn time_discovery_request(endpoint: &'static str) -> HistogramTimer {
    DISCOVERY_REQUEST_DURATION
        .with_label_values(&[endpoint])
        .start_timer()
}

pub fn inc_discovery_request(endpoint: &'static str, status: &str) {
    DISCOVERY_REQUEST_TOTAL
        .with_label_values(&[endpoint, status])
        .inc();
}

pub fn time_discovery_query(query: &'static str) -> HistogramTimer {
    DISCOVERY_DB_QUERY_DURATION
        .with_label_values(&[query])
        .start_timer()
}

pub fn time_rpc(method: &'static str) -> HistogramTimer {
    RPC_CALL_DURATION.with_label_values(&[method]).start_timer()
}

pub fn time_poll(program: &'static str) -> HistogramTimer {
    POLL_CYCLE_DURATION
        .with_label_values(&[program])
        .start_timer()
}

pub fn set_pool_max(max: u32) {
    DB_POOL_MAX.set(max as i64);
}

fn sample_pool(pool: &PgPool) {
    let s = pool.state();
    DB_POOL_CONNECTIONS.set(s.connections as i64);
    DB_POOL_IDLE.set(s.idle_connections as i64);
}

pub fn render(pool: &PgPool) -> String {
    sample_pool(pool);
    let mf = prometheus::gather();
    let mut buf = Vec::new();
    TextEncoder::new().encode(&mf, &mut buf).ok();
    String::from_utf8(buf).unwrap_or_default()
}
