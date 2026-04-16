//! Reorg watcher. Periodically asks the RPC whether recently ingested
//! signatures are still on the confirmed chain. Drops + rewinds on divergence.
//!
//! Backend spec §3.3 calls for slot-level rollback on fork detection. This
//! module implements that over JSON-RPC (no Yellowstone dependency): for every
//! signature in a rolling recent window we call `getSignatureStatuses`. A null
//! entry means the cluster no longer knows that signature — it was reorged out
//! or purged. We take the smallest such slot as `fork_slot`, delete every
//! `program_events` row at or above it, insert one `reorg_log` entry per
//! dropped signature, and rewind each program's `sync_cursor` to the latest
//! surviving event below `fork_slot` so the poller replays from there.
//!
//! The status cache on a Solana RPC only retains the last ~150 slots without
//! `searchTransactionHistory=true`, so we restrict candidates to that window.
//! Events older than the window are ignored — they are past practical finality
//! and any reorg affecting them would be a consensus failure, not a fork.

use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use diesel::prelude::*;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

use crate::config::Config;
use crate::db::PgPool;
use crate::metrics;
use crate::programs;
use crate::schema::{program_events, reorg_log, sync_cursor};

const STATUS_BATCH: usize = 256;

pub async fn run(cfg: Config, pool: PgPool) -> Result<()> {
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()?;

    let mut ticker = tokio::time::interval(Duration::from_secs(cfg.reorg_check_interval_s));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        ticker.tick().await;
        match check_once(&cfg, &http, &pool).await {
            Ok(0) => {}
            Ok(n) => tracing::info!(dropped = n, "reorg watcher rolled back events"),
            Err(e) => {
                tracing::warn!(error = %e, "reorg watcher cycle failed");
                metrics::RPC_ERRORS
                    .with_label_values(&["reorg_check"])
                    .inc();
            }
        }
    }
}

async fn check_once(cfg: &Config, http: &reqwest::Client, pool: &PgPool) -> Result<usize> {
    let latest = get_latest_slot(cfg, http).await?;
    let window_start = latest.saturating_sub(cfg.reorg_window_slots as i64);

    let candidates = {
        let p = pool.clone();
        let depth = cfg.reorg_window_depth as i64;
        tokio::task::spawn_blocking(move || read_recent_events(&p, window_start, depth)).await??
    };
    if candidates.is_empty() {
        return Ok(0);
    }

    let statuses = fetch_statuses(cfg, http, &candidates).await?;
    let dropped = detect_dropped(&candidates, &statuses);
    if dropped.is_empty() {
        return Ok(0);
    }

    let fork_slot = dropped
        .iter()
        .map(|d| d.slot)
        .min()
        .expect("dropped non-empty");

    let dropped_for_task = dropped.clone();
    let pool_for_task = pool.clone();
    let deleted = tokio::task::spawn_blocking(move || {
        rollback(&pool_for_task, fork_slot, &dropped_for_task)
    })
    .await??;

    metrics::REORG_EVENTS_ROLLED_BACK.inc_by(deleted as u64);
    for d in &dropped {
        if let Some(name) = programs::name_for(&d.program_id) {
            metrics::REORG_DETECTED
                .with_label_values(&[name])
                .inc();
        }
    }
    tracing::warn!(
        fork_slot,
        dropped = dropped.len(),
        deleted,
        "reorg detected; events rolled back"
    );
    Ok(deleted)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecentEvent {
    pub signature: String,
    pub slot: i64,
    pub program_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DroppedSig {
    pub signature: String,
    pub slot: i64,
    pub program_id: String,
}

/// Signature lookup state. `None` = RPC returned null for the sig.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SigLookup {
    Present,
    Missing,
}

pub fn detect_dropped(
    events: &[RecentEvent],
    statuses: &HashMap<String, SigLookup>,
) -> Vec<DroppedSig> {
    events
        .iter()
        .filter(|e| !matches!(statuses.get(&e.signature), Some(SigLookup::Present)))
        .map(|e| DroppedSig {
            signature: e.signature.clone(),
            slot: e.slot,
            program_id: e.program_id.clone(),
        })
        .collect()
}

fn read_recent_events(
    pool: &PgPool,
    window_start: i64,
    depth: i64,
) -> Result<Vec<RecentEvent>> {
    let mut conn = pool.get()?;
    let rows: Vec<(String, i64, String)> = program_events::table
        .filter(program_events::slot.ge(window_start))
        .order(program_events::id.desc())
        .limit(depth)
        .select((
            program_events::signature,
            program_events::slot,
            program_events::program_id,
        ))
        .load(&mut conn)?;
    Ok(rows
        .into_iter()
        .map(|(signature, slot, program_id)| RecentEvent {
            signature,
            slot,
            program_id,
        })
        .collect())
}

fn rollback(pool: &PgPool, fork_slot: i64, dropped: &[DroppedSig]) -> Result<usize> {
    let mut conn = pool.get()?;
    conn.transaction::<usize, anyhow::Error, _>(|conn| {
        for d in dropped {
            diesel::insert_into(reorg_log::table)
                .values((
                    reorg_log::slot.eq(d.slot),
                    reorg_log::old_hash.eq(&d.signature),
                    reorg_log::new_hash.eq("dropped"),
                    reorg_log::detected_at.eq(Utc::now()),
                ))
                .execute(conn)?;
        }

        let deleted = diesel::delete(
            program_events::table.filter(program_events::slot.ge(fork_slot)),
        )
        .execute(conn)?;

        for p in programs::SAEP_PROGRAMS {
            let prior: Option<(String, i64)> = program_events::table
                .filter(program_events::program_id.eq(p.id))
                .filter(program_events::slot.lt(fork_slot))
                .order(program_events::slot.desc())
                .select((program_events::signature, program_events::slot))
                .first(conn)
                .optional()?;

            let rewound = match prior {
                Some((sig, slot)) => diesel::update(
                    sync_cursor::table.filter(sync_cursor::program_id.eq(p.id)),
                )
                .set((
                    sync_cursor::last_sig.eq(Some(sig)),
                    sync_cursor::last_slot.eq(Some(slot)),
                    sync_cursor::updated_at.eq(Utc::now()),
                ))
                .execute(conn)?,
                None => diesel::update(
                    sync_cursor::table.filter(sync_cursor::program_id.eq(p.id)),
                )
                .set((
                    sync_cursor::last_sig.eq::<Option<String>>(None),
                    sync_cursor::last_slot.eq::<Option<i64>>(None),
                    sync_cursor::updated_at.eq(Utc::now()),
                ))
                .execute(conn)?,
            };
            let _ = rewound;
        }

        Ok(deleted)
    })
}

async fn get_latest_slot(cfg: &Config, http: &reqwest::Client) -> Result<i64> {
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getSlot",
        "params": [{ "commitment": "confirmed" }],
    });
    let timer = metrics::time_rpc("getSlot");
    let v: Value = http.post(&cfg.rpc_url).json(&body).send().await?.json().await?;
    timer.observe_duration();
    if let Some(err) = v.get("error") {
        metrics::RPC_ERRORS
            .with_label_values(&["getSlot"])
            .inc();
        return Err(anyhow!("rpc error: {err}"));
    }
    v.get("result")
        .and_then(|r| r.as_i64())
        .context("getSlot result missing")
}

async fn fetch_statuses(
    cfg: &Config,
    http: &reqwest::Client,
    events: &[RecentEvent],
) -> Result<HashMap<String, SigLookup>> {
    let mut out: HashMap<String, SigLookup> = HashMap::with_capacity(events.len());

    // Dedupe — same sig may appear for multiple events in the window.
    let mut unique: Vec<&str> = events.iter().map(|e| e.signature.as_str()).collect();
    unique.sort();
    unique.dedup();

    for chunk in unique.chunks(STATUS_BATCH) {
        let body = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getSignatureStatuses",
            "params": [chunk, { "searchTransactionHistory": false }],
        });
        let timer = metrics::time_rpc("getSignatureStatuses");
        let v: Value = http.post(&cfg.rpc_url).json(&body).send().await?.json().await?;
        timer.observe_duration();
        if let Some(err) = v.get("error") {
            metrics::RPC_ERRORS
                .with_label_values(&["getSignatureStatuses"])
                .inc();
            return Err(anyhow!("rpc error: {err}"));
        }
        let arr = v
            .pointer("/result/value")
            .and_then(|r| r.as_array())
            .cloned()
            .unwrap_or_default();
        for (sig, entry) in chunk.iter().zip(arr.iter()) {
            let lookup = if entry.is_null() {
                SigLookup::Missing
            } else {
                SigLookup::Present
            };
            out.insert((*sig).to_string(), lookup);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(sig: &str, slot: i64, pid: &str) -> RecentEvent {
        RecentEvent {
            signature: sig.into(),
            slot,
            program_id: pid.into(),
        }
    }

    #[test]
    fn dropped_when_status_null() {
        let events = vec![
            ev("a", 100, "p1"),
            ev("b", 101, "p1"),
            ev("c", 102, "p2"),
        ];
        let mut statuses = HashMap::new();
        statuses.insert("a".into(), SigLookup::Present);
        statuses.insert("b".into(), SigLookup::Missing);
        statuses.insert("c".into(), SigLookup::Present);

        let dropped = detect_dropped(&events, &statuses);
        assert_eq!(dropped.len(), 1);
        assert_eq!(dropped[0].signature, "b");
        assert_eq!(dropped[0].slot, 101);
    }

    #[test]
    fn missing_from_map_treated_as_dropped() {
        let events = vec![ev("a", 100, "p1")];
        let statuses = HashMap::new();
        let dropped = detect_dropped(&events, &statuses);
        assert_eq!(dropped.len(), 1);
    }

    #[test]
    fn fork_slot_is_minimum_of_dropped() {
        let events = vec![
            ev("a", 120, "p1"),
            ev("b", 118, "p1"),
            ev("c", 115, "p2"),
            ev("d", 122, "p2"),
        ];
        let mut statuses = HashMap::new();
        statuses.insert("a".into(), SigLookup::Missing);
        statuses.insert("b".into(), SigLookup::Present);
        statuses.insert("c".into(), SigLookup::Missing);
        statuses.insert("d".into(), SigLookup::Missing);

        let dropped = detect_dropped(&events, &statuses);
        let fork_slot = dropped.iter().map(|d| d.slot).min().unwrap();
        assert_eq!(fork_slot, 115);
        assert_eq!(dropped.len(), 3);
    }

    #[test]
    fn empty_events_yield_empty_dropped() {
        let dropped = detect_dropped(&[], &HashMap::new());
        assert!(dropped.is_empty());
    }

    #[test]
    fn all_present_yields_empty_dropped() {
        let events = vec![ev("a", 100, "p1"), ev("b", 101, "p1")];
        let mut statuses = HashMap::new();
        statuses.insert("a".into(), SigLookup::Present);
        statuses.insert("b".into(), SigLookup::Present);
        assert!(detect_dropped(&events, &statuses).is_empty());
    }
}
