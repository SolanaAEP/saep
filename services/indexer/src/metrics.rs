use once_cell::sync::Lazy;
use prometheus::{
    register_int_counter_vec, register_int_gauge_vec, Encoder, IntCounterVec, IntGaugeVec,
    TextEncoder,
};

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

pub fn render() -> String {
    let mf = prometheus::gather();
    let mut buf = Vec::new();
    TextEncoder::new().encode(&mf, &mut buf).ok();
    String::from_utf8(buf).unwrap_or_default()
}
