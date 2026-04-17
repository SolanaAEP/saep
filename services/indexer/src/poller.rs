use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use diesel::prelude::*;
use serde_json::{json, Value};
use std::time::Duration;

use crate::config::Config;
use crate::db::PgPool;
use crate::idl::{self, Registry};
use crate::ingest::{self, NewEvent};
use crate::metrics;
use crate::programs::{self, SaepProgram};
use crate::pubsub::Publisher;
use crate::schema::sync_cursor;

pub async fn run(cfg: Config, pool: PgPool, publisher: Publisher) -> Result<()> {
    let idl_dir = idl::default_idl_path();
    let registry = Registry::load_from_dir(&idl_dir)
        .with_context(|| format!("loading anchor IDLs from {}", idl_dir.display()))?;
    tracing::info!(
        idl_dir = %idl_dir.display(),
        programs = registry.programs_loaded().len(),
        events = registry.event_count(),
        "idl registry loaded"
    );

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()?;

    let mut ticker = tokio::time::interval(Duration::from_millis(cfg.poll_interval_ms));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    let stagger = Duration::from_millis(
        (cfg.poll_interval_ms / programs::SAEP_PROGRAMS.len() as u64).max(250),
    );

    loop {
        ticker.tick().await;
        for p in programs::SAEP_PROGRAMS {
            let timer = metrics::time_poll(p.name);
            if let Err(e) = poll_program(&cfg, &http, &pool, &registry, &publisher, p).await {
                tracing::warn!(program = p.name, error = %e, "poll cycle failed");
                metrics::RPC_ERRORS.with_label_values(&["poll_cycle"]).inc();
            }
            timer.observe_duration();
            tokio::time::sleep(stagger).await;
        }
    }
}

async fn poll_program(
    cfg: &Config,
    http: &reqwest::Client,
    pool: &PgPool,
    registry: &Registry,
    publisher: &Publisher,
    p: &SaepProgram,
) -> Result<()> {
    let until = read_cursor(pool, p.id)?;
    let sigs = get_signatures(cfg, http, p.id, until.as_deref(), cfg.page_limit).await?;
    if sigs.is_empty() {
        return Ok(());
    }

    // Oldest first so the cursor advances monotonically.
    for entry in sigs.iter().rev() {
        let signature = entry
            .get("signature")
            .and_then(|s| s.as_str())
            .ok_or_else(|| anyhow!("signature missing"))?;
        let slot = entry.get("slot").and_then(|s| s.as_i64()).unwrap_or(0);

        if entry.get("err").map(|e| !e.is_null()).unwrap_or(false) {
            write_cursor(pool, p.id, signature, slot)?;
            continue;
        }

        let tx = match get_transaction(cfg, http, signature).await? {
            Some(v) => v,
            None => {
                write_cursor(pool, p.id, signature, slot)?;
                continue;
            }
        };

        ingest_tx(pool, registry, publisher, p, signature, slot, &tx);
        write_cursor(pool, p.id, signature, slot)?;
        metrics::LAST_SLOT
            .with_label_values(&[p.name])
            .set(slot);
    }
    Ok(())
}

fn ingest_tx(
    pool: &PgPool,
    registry: &Registry,
    publisher: &Publisher,
    p: &SaepProgram,
    signature: &str,
    slot: i64,
    tx: &Value,
) {
    let block_time = tx.get("blockTime").and_then(|v| v.as_i64());
    let meta = match tx.get("meta") {
        Some(m) if !m.is_null() => m,
        _ => return,
    };
    let message = match tx.pointer("/transaction/message") {
        Some(m) => m,
        None => return,
    };
    let account_keys = match message.get("accountKeys").and_then(|a| a.as_array()) {
        Some(a) => a,
        None => return,
    };

    // Resolve account index -> pubkey string; accountKeys is ordered
    // [static writable, static readonly, loaded writable, loaded readonly].
    // Loaded addresses come from loadedAddresses in meta (confirmed commitment).
    let mut keys: Vec<String> = account_keys
        .iter()
        .filter_map(|k| k.as_str().map(String::from))
        .collect();
    if let Some(loaded) = meta.get("loadedAddresses") {
        if let Some(w) = loaded.get("writable").and_then(|a| a.as_array()) {
            keys.extend(w.iter().filter_map(|k| k.as_str().map(String::from)));
        }
        if let Some(r) = loaded.get("readonly").and_then(|a| a.as_array()) {
            keys.extend(r.iter().filter_map(|k| k.as_str().map(String::from)));
        }
    }

    let inner = match meta.get("innerInstructions").and_then(|a| a.as_array()) {
        Some(a) => a,
        None => return,
    };

    for group in inner {
        let ixs = match group.get("instructions").and_then(|a| a.as_array()) {
            Some(a) => a,
            None => continue,
        };
        for ix in ixs {
            let prog_idx = ix
                .get("programIdIndex")
                .and_then(|v| v.as_u64())
                .map(|v| v as usize);
            let pid = prog_idx
                .and_then(|i| keys.get(i))
                .map(|s| s.as_str())
                .unwrap_or("");
            if pid != p.id {
                continue;
            }
            let data_b58 = match ix.get("data").and_then(|d| d.as_str()) {
                Some(s) => s,
                None => continue,
            };
            let bytes = match bs58::decode(data_b58).into_vec() {
                Ok(b) => b,
                Err(_) => continue,
            };
            if bytes.len() < 8 {
                continue;
            }
            if let Some((event_name, data)) =
                ingest::decode_event(registry, p.id, &bytes)
            {
                let ev = NewEvent {
                    signature,
                    slot,
                    program_id: p.id,
                    event_name: &event_name,
                    data: data.clone(),
                    ingested_at: Utc::now(),
                };
                if let Err(e) = ingest::record_event(pool, ev) {
                    tracing::warn!(error = %e, signature, "record_event failed");
                } else {
                    metrics::EVENTS_INGESTED
                        .with_label_values(&[p.name, &event_name])
                        .inc();
                    if let Some(bt) = block_time {
                        let lag = (Utc::now().timestamp() - bt).max(0) as f64;
                        metrics::INGEST_LAG
                            .with_label_values(&[p.name])
                            .observe(lag);
                    }
                    publisher.spawn_publish(
                        p.name, p.id, &event_name, signature, slot, &data,
                    );
                }
            }
        }
    }
}

async fn get_signatures(
    cfg: &Config,
    http: &reqwest::Client,
    program_id: &str,
    until: Option<&str>,
    limit: u16,
) -> Result<Vec<Value>> {
    let mut params = json!({ "limit": limit, "commitment": "confirmed" });
    if let Some(u) = until {
        params["until"] = Value::String(u.to_string());
    }
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getSignaturesForAddress",
        "params": [program_id, params],
    });
    let timer = metrics::time_rpc("getSignaturesForAddress");
    let v: Value = http
        .post(&cfg.rpc_url)
        .json(&body)
        .send()
        .await?
        .json()
        .await?;
    timer.observe_duration();
    if let Some(err) = v.get("error") {
        metrics::RPC_ERRORS
            .with_label_values(&["getSignaturesForAddress"])
            .inc();
        return Err(anyhow!("rpc error: {err}"));
    }
    Ok(v.get("result")
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default())
}

async fn get_transaction(
    cfg: &Config,
    http: &reqwest::Client,
    sig: &str,
) -> Result<Option<Value>> {
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getTransaction",
        "params": [
            sig,
            {
                "commitment": "confirmed",
                "encoding": "json",
                "maxSupportedTransactionVersion": 0
            }
        ],
    });
    let timer = metrics::time_rpc("getTransaction");
    let v: Value = http
        .post(&cfg.rpc_url)
        .json(&body)
        .send()
        .await?
        .json()
        .await?;
    timer.observe_duration();
    if let Some(err) = v.get("error") {
        metrics::RPC_ERRORS
            .with_label_values(&["getTransaction"])
            .inc();
        return Err(anyhow!("rpc error: {err}"));
    }
    Ok(v.get("result").filter(|r| !r.is_null()).cloned())
}

fn read_cursor(pool: &PgPool, program_id: &str) -> Result<Option<String>> {
    let mut conn = pool.get()?;
    let row: Option<Option<String>> = sync_cursor::table
        .filter(sync_cursor::program_id.eq(program_id))
        .select(sync_cursor::last_sig)
        .first(&mut conn)
        .optional()?;
    Ok(row.flatten())
}

fn write_cursor(pool: &PgPool, program_id: &str, sig: &str, slot: i64) -> Result<()> {
    let mut conn = pool.get()?;
    diesel::insert_into(sync_cursor::table)
        .values((
            sync_cursor::program_id.eq(program_id),
            sync_cursor::last_sig.eq(sig),
            sync_cursor::last_slot.eq(slot),
            sync_cursor::updated_at.eq(Utc::now()),
        ))
        .on_conflict(sync_cursor::program_id)
        .do_update()
        .set((
            sync_cursor::last_sig.eq(sig),
            sync_cursor::last_slot.eq(slot),
            sync_cursor::updated_at.eq(Utc::now()),
        ))
        .execute(&mut conn)?;
    Ok(())
}
