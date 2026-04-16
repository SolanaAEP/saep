//! Integration test for the task bidding API surface.
//!
//! Docker isn't in scope on dev machines here, so this test is `#[ignore]`d by
//! default and drives a real Postgres via `SAEP_TEST_DATABASE_URL`. Run with:
//!
//!     createdb saep_indexer_test
//!     SAEP_TEST_DATABASE_URL=postgres://localhost/saep_indexer_test \
//!         cargo test -p saep-indexer --test bidding_api -- --ignored --nocapture
//!
//! The test wipes `blocks` and `program_events` on entry so the DB can be
//! reused across runs.
//!
//! Uses `tower::ServiceExt::oneshot` to dispatch requests in-process — no port
//! binding, no async runtime races against a live server.

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use chrono::Utc;
use diesel::prelude::*;
use diesel::sql_query;
use saep_indexer::db::{pool, run_migrations, PgPool};
use saep_indexer::ingest::NewEvent;
use saep_indexer::schema::{blocks, program_events};
use serde_json::{json, Value};
use tower::ServiceExt;

const TASK_MARKET_ID: &str = "HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w";

fn task_id_json(byte: u8) -> Value {
    Value::Array((0..32).map(|_| Value::from(byte)).collect())
}

fn task_id_hex(byte: u8) -> String {
    hex::encode([byte; 32])
}

fn ensure_block(pool: &PgPool, slot: i64) {
    let mut conn = pool.get().expect("conn");
    diesel::insert_into(blocks::table)
        .values((
            blocks::slot.eq(slot),
            blocks::hash.eq(format!("hash-{slot}")),
            blocks::parent_slot.eq::<Option<i64>>(None),
            blocks::processed_at.eq(Utc::now()),
        ))
        .on_conflict(blocks::slot)
        .do_nothing()
        .execute(&mut conn)
        .expect("insert block");
}

fn insert_event(pool: &PgPool, sig: &str, slot: i64, event_name: &str, data: Value) {
    ensure_block(pool, slot);
    let mut conn = pool.get().expect("conn");
    let e = NewEvent {
        signature: sig,
        slot,
        program_id: TASK_MARKET_ID,
        event_name,
        data,
        ingested_at: Utc::now(),
    };
    diesel::insert_into(program_events::table)
        .values(&e)
        .on_conflict_do_nothing()
        .execute(&mut conn)
        .expect("insert event");
}

fn clean(pool: &PgPool) {
    let mut conn = pool.get().expect("conn");
    sql_query("TRUNCATE program_events, blocks RESTART IDENTITY CASCADE")
        .execute(&mut conn)
        .expect("truncate");
}

fn seed(pool: &PgPool) {
    let t1 = task_id_json(0x01);
    let bidder_a = "3XnKcGbqR2JmHX1gN1sXrH7a3YtHKf5v9eUyAMKQX4wc";
    let bidder_b = "9hZkUWnwG7BfVqLa2x9P2ChmH8f1p1XBj5VgTQwqpVfN";

    insert_event(
        pool,
        "sig-t1-open",
        100,
        "BidBookOpened",
        json!({
            "task_id": t1,
            "commit_end": "1800000000",
            "reveal_end": "1800003600",
            "bond_amount": "1000000",
        }),
    );
    insert_event(
        pool,
        "sig-t1-commit-a",
        101,
        "BidCommitted",
        json!({
            "task_id": t1,
            "bidder": bidder_a,
            "bond_paid": "1000000",
        }),
    );
    insert_event(
        pool,
        "sig-t1-commit-b",
        102,
        "BidCommitted",
        json!({
            "task_id": t1,
            "bidder": bidder_b,
            "bond_paid": "1000000",
        }),
    );
    insert_event(
        pool,
        "sig-t1-reveal-a",
        110,
        "BidRevealed",
        json!({
            "task_id": t1,
            "bidder": bidder_a,
            "amount": "5000000",
        }),
    );
    insert_event(
        pool,
        "sig-t1-reveal-b",
        111,
        "BidRevealed",
        json!({
            "task_id": t1,
            "bidder": bidder_b,
            "amount": "4500000",
        }),
    );
    insert_event(
        pool,
        "sig-t1-close",
        120,
        "BidBookClosed",
        json!({
            "task_id": t1,
            "winner_agent": bidder_b,
            "winner_amount": "4500000",
            "reveal_count": 2,
        }),
    );

    let t2 = task_id_json(0x02);
    insert_event(
        pool,
        "sig-t2-open",
        200,
        "BidBookOpened",
        json!({
            "task_id": t2,
            "commit_end": "1800000000",
            "reveal_end": "1800003600",
            "bond_amount": "2000000",
        }),
    );

    let t3 = task_id_json(0x03);
    let bidder_c = "6kW1bK7T7aRmGDZRwYXhWjrZJH6rFq7z2xZTz2kCAZTT";
    insert_event(
        pool,
        "sig-t3-open",
        300,
        "BidBookOpened",
        json!({
            "task_id": t3,
            "commit_end": "1800000000",
            "reveal_end": "1800003600",
            "bond_amount": "3000000",
        }),
    );
    insert_event(
        pool,
        "sig-t3-slash",
        301,
        "BidSlashed",
        json!({
            "task_id": t3,
            "bidder": bidder_c,
            "bond_amount": "3000000",
        }),
    );
}

async fn get_json(router: &axum::Router, path: &str) -> (StatusCode, Value) {
    let resp = router
        .clone()
        .oneshot(
            Request::builder()
                .uri(path)
                .body(Body::empty())
                .expect("req"),
        )
        .await
        .expect("oneshot");
    let status = resp.status();
    let body = to_bytes(resp.into_body(), 1 << 20).await.expect("body");
    let v: Value = serde_json::from_slice(&body).expect("json");
    (status, v)
}

#[tokio::test]
#[ignore = "requires Postgres; set SAEP_TEST_DATABASE_URL and run with --ignored"]
async fn bidding_endpoints_happy_paths() {
    let url = std::env::var("SAEP_TEST_DATABASE_URL")
        .expect("SAEP_TEST_DATABASE_URL not set (see test header for usage)");
    let pool = pool(&url).expect("pool");
    run_migrations(&pool).expect("migrations");
    clean(&pool);
    seed(&pool);

    let router = saep_indexer::api::router(pool.clone());

    let (status, body) = get_json(&router, &format!("/tasks/{}/bidding", task_id_hex(0x01))).await;
    assert_eq!(status, StatusCode::OK, "t1 bidding: {body}");
    assert_eq!(body["phase"], "settled");
    assert_eq!(body["commit_count"], 2);
    assert_eq!(body["reveal_count"], 2);
    assert_eq!(body["slashed_count"], 0);
    assert_eq!(body["bond_amount"], "1000000");
    assert_eq!(body["commit_end_unix"], 1_800_000_000i64);
    assert_eq!(body["reveal_end_unix"], 1_800_003_600i64);
    assert!(body["winner_agent"].is_string(), "winner_agent: {body}");
    assert_eq!(body["winner_amount"], "4500000");

    let (status, body) = get_json(&router, &format!("/tasks/{}/bidding", task_id_hex(0x02))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["phase"], "commit");
    assert_eq!(body["commit_count"], 0);
    assert_eq!(body["reveal_count"], 0);
    assert_eq!(body["slashed_count"], 0);
    assert!(body["winner_agent"].is_null());

    let (status, body) = get_json(&router, &format!("/tasks/{}/bidding", task_id_hex(0x03))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["phase"], "commit");
    assert_eq!(body["slashed_count"], 1);

    let (status, body) = get_json(&router, &format!("/tasks/{}/bids", task_id_hex(0x01))).await;
    assert_eq!(status, StatusCode::OK);
    let rows = body.as_array().expect("array");
    assert_eq!(rows.len(), 2, "expected 2 bidders: {body}");
    for row in rows {
        assert!(row["bond_paid"].is_string(), "bond_paid missing: {row}");
        assert!(
            row["revealed_amount"].is_string(),
            "revealed_amount missing: {row}"
        );
        assert_eq!(row["slashed"], false);
    }
}

#[tokio::test]
#[ignore = "requires Postgres; set SAEP_TEST_DATABASE_URL and run with --ignored"]
async fn bidding_bad_hex_returns_400() {
    let url = std::env::var("SAEP_TEST_DATABASE_URL")
        .expect("SAEP_TEST_DATABASE_URL not set");
    let pool = pool(&url).expect("pool");
    run_migrations(&pool).expect("migrations");
    let router = saep_indexer::api::router(pool);

    let (status, _) = get_json(&router, "/tasks/not-hex/bidding").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, _) = get_json(&router, "/tasks/deadbeef/bidding").await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "wrong length should 400");
}
