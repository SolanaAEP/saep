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
